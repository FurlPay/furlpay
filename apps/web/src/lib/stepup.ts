import { kvGet, kvSet, kvDel, kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Server-enforced, SESSION-BOUND step-up authentication.
//
// Some actions must not be authorized by a bare session alone — a stolen
// session should not be enough. Wallet linking is one: an attacker who steals a
// session before the victim links could otherwise bind their own address.
//
// The step-up record is keyed by (userId, session jti), so:
//   - a DIFFERENT (stolen/concurrent) session has no step-up and is blocked;
//   - an attacker cannot ride a step-up the victim completed on the victim's
//     OWN session for an unrelated action — it is bound to that session's jti,
//     not the attacker's.
// Freshness is server-authoritative (kv timestamp), never a client claim, and
// the record is consumed on a successful link (single-use → no in-window
// replay). Local device biometrics do NOT count: they gate the device key,
// not control of the server-side FurlPay account.
// ---------------------------------------------------------------------------

export type StepUpMethod = "otp" | "passkey";

const KEY = (userId: string, jti: string) => `stepup:${userId}:${jti}`;
const RECORD_TTL_S = 15 * 60; // stored 15 min; callers enforce a tighter window
const DEFAULT_MAX_AGE_MS = 10 * 60_000; // "recent" = within 10 minutes

interface StepUpRecord {
  method: StepUpMethod;
  at: number; // epoch ms
}

/** Record that this SESSION (jti) just completed a strong re-auth. */
export async function recordStepUp(userId: string, jti: string, method: StepUpMethod): Promise<void> {
  if (!jti) return;
  await kvSet(KEY(userId, jti), { method, at: Date.now() } satisfies StepUpRecord, RECORD_TTL_S);
}

/** True if THIS session has a step-up within `maxAgeMs`. Server-authoritative. */
export async function recentStepUp(userId: string, jti: string | undefined, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<boolean> {
  if (!jti) return false;
  const rec = await kvGet<StepUpRecord>(KEY(userId, jti));
  return Boolean(rec && typeof rec.at === "number" && Date.now() - rec.at <= maxAgeMs);
}

/**
 * Atomically claim THIS session's recent step-up for one privileged action.
 * True for exactly one caller per step-up: recentStepUp() + consumeStepUp() is
 * check-then-delete, so two concurrent requests could both pass on a single
 * re-authentication. The claim is a SET NX keyed to the step-up's own
 * timestamp; the record is then deleted so it cannot be reused at all.
 */
export async function claimStepUp(userId: string, jti: string | undefined, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<boolean> {
  if (!jti) return false;
  const rec = await kvGet<StepUpRecord>(KEY(userId, jti));
  if (!rec || typeof rec.at !== "number" || Date.now() - rec.at > maxAgeMs) return false;
  const won = await kvSetNx(`${KEY(userId, jti)}:claimed:${rec.at}`, 1, RECORD_TTL_S);
  if (won) await kvDel(KEY(userId, jti)).catch(() => {});
  return won;
}

/** Consume the step-up (single-use) after the guarded action succeeds. */
export async function consumeStepUp(userId: string, jti: string | undefined): Promise<void> {
  if (!jti) return;
  await kvDel(KEY(userId, jti)).catch(() => {});
}
