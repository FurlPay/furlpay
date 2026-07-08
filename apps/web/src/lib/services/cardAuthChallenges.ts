import { randomBytes } from "crypto";
import { kvGet, kvSet, kvDel } from "@/lib/kv";

// ---------------------------------------------------------------------------
// 3DS2 out-of-band (OOB) challenge registry for card authorizations.
//
// When the JIT webhook step-ups a transaction, it registers a challenge here,
// pushes it to the user's device, and the mobile app resolves it with a
// passkey (WebAuthn) assertion. State lives in the kv layer so the webhook
// instance that created the challenge and the instance that verifies the
// approval don't have to be the same lambda.
//
// Lifecycle: pending → approved | declined | expired.
// A challenge is single-decision: once decided it can never flip.
// ---------------------------------------------------------------------------

/** How long the user has to approve on their phone. EMVCo 3DS2 OOB flows
 *  typically allow 5–10 minutes; card networks poll the ACS meanwhile. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
/** Keep decided challenges readable a bit longer for issuer status polls. */
const RECORD_TTL_SECONDS = 30 * 60;

export type ChallengeStatus = "pending" | "approved" | "declined" | "expired";

export interface CardAuthChallenge {
  id: string;
  /** Issuer-side authorization id (Stripe `iauth_…` / Marqeta JIT token). */
  authorizationId: string;
  userId: string;
  cardId: string;
  amountUsd: number;
  currency: string;
  merchant: { name: string; city?: string; country?: string; mcc?: string };
  status: ChallengeStatus;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  /** Server-generated WebAuthn assertion challenge, bound to THIS card-auth
   *  challenge so an assertion for one purchase can never approve another. */
  webauthnChallenge?: string;
}

const chalKey = (id: string) => `cardauth:chal:${id}`;
const pendingKey = (userId: string) => `cardauth:pending:${userId}`;

function isExpired(c: CardAuthChallenge): boolean {
  return c.status === "pending" && new Date(c.expiresAt).getTime() < Date.now();
}

export async function createChallenge(init: {
  authorizationId: string;
  userId: string;
  cardId: string;
  amountUsd: number;
  currency: string;
  merchant: CardAuthChallenge["merchant"];
}): Promise<CardAuthChallenge> {
  const now = Date.now();
  const challenge: CardAuthChallenge = {
    id: "chal_" + randomBytes(12).toString("hex"),
    ...init,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  };
  await kvSet(chalKey(challenge.id), challenge, RECORD_TTL_SECONDS);

  const pending = (await kvGet<string[]>(pendingKey(init.userId))) ?? [];
  await kvSet(pendingKey(init.userId), [...pending, challenge.id], RECORD_TTL_SECONDS);
  return challenge;
}

export async function getChallenge(id: string): Promise<CardAuthChallenge | null> {
  const c = await kvGet<CardAuthChallenge>(chalKey(id));
  if (!c) return null;
  if (isExpired(c)) {
    c.status = "expired";
    await kvSet(chalKey(id), c, RECORD_TTL_SECONDS);
  }
  return c;
}

/** Pending (still-decidable) challenges for a user, oldest first. */
export async function listPendingChallenges(userId: string): Promise<CardAuthChallenge[]> {
  const ids = (await kvGet<string[]>(pendingKey(userId))) ?? [];
  const out: CardAuthChallenge[] = [];
  const stillPending: string[] = [];
  for (const id of ids) {
    const c = await getChallenge(id);
    if (c?.status === "pending") {
      out.push(c);
      stillPending.push(id);
    }
  }
  if (stillPending.length !== ids.length) {
    if (stillPending.length) await kvSet(pendingKey(userId), stillPending, RECORD_TTL_SECONDS);
    else await kvDel(pendingKey(userId));
  }
  return out;
}

/** Bind a WebAuthn assertion challenge to a pending card-auth challenge.
 *  Overwrites any previous binding (only the latest ceremony counts). */
export async function bindWebauthnChallenge(id: string, webauthnChallenge: string): Promise<CardAuthChallenge | null> {
  const c = await getChallenge(id);
  if (!c || c.status !== "pending") return null;
  c.webauthnChallenge = webauthnChallenge;
  await kvSet(chalKey(id), c, RECORD_TTL_SECONDS);
  return c;
}

/** One-shot decision. Returns the updated record, or null when the challenge
 *  is unknown, already decided, or expired (fail closed — never re-open). */
export async function decideChallenge(
  id: string,
  decision: "approved" | "declined",
  reason?: string
): Promise<CardAuthChallenge | null> {
  const c = await getChallenge(id);
  if (!c || c.status !== "pending") return null;
  c.status = decision;
  c.reason = reason;
  c.decidedAt = new Date().toISOString();
  delete c.webauthnChallenge; // ceremony is spent
  await kvSet(chalKey(id), c, RECORD_TTL_SECONDS);
  return c;
}
