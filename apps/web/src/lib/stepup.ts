import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Server-enforced step-up authentication.
//
// Some actions must not be authorized by a bare session alone — a stolen
// session should not be enough. Wallet linking is one: an attacker who steals a
// session before the victim links a wallet could otherwise bind their own
// address permanently. We require a RECENT high-assurance re-authentication —
// a fresh email/SMS OTP verification or a passkey assertion — recorded
// server-side. Local device biometrics do NOT count: they gate the device key,
// they do not prove control of the server-side FurlPay account.
//
// Freshness is server-authoritative (kv timestamp), never a client claim.
// ---------------------------------------------------------------------------

export type StepUpMethod = "otp" | "passkey";

const KEY = (userId: string) => `stepup:${userId}`;
const RECORD_TTL_S = 15 * 60; // stored 15 min; callers enforce a tighter window
const DEFAULT_MAX_AGE_MS = 10 * 60_000; // "recent" = within 10 minutes

interface StepUpRecord {
  method: StepUpMethod;
  at: number; // epoch ms
}

/** Record that the user just completed a strong re-auth (OTP / passkey). */
export async function recordStepUp(userId: string, method: StepUpMethod): Promise<void> {
  const rec: StepUpRecord = { method, at: Date.now() };
  await kvSet(KEY(userId), rec, RECORD_TTL_S);
}

/** True if the user has a step-up within `maxAgeMs`. Server-authoritative. */
export async function recentStepUp(userId: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<boolean> {
  const rec = await kvGet<StepUpRecord>(KEY(userId));
  return Boolean(rec && typeof rec.at === "number" && Date.now() - rec.at <= maxAgeMs);
}
