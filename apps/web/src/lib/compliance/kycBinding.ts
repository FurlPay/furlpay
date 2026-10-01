import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Server-side binding between a provider verification session and the FurlPay
// user it was started for.
//
// WHY THE REFERENCE ID IS NOT ENOUGH. Both KYC webhooks used to resolve the
// account from the reference the inquiry/applicant carries (Persona
// `reference-id`, Sumsub `externalUserId`). That reference is not a secret and
// is not always chosen by us:
//   - /api/compliance/verify accepted a client-supplied `referenceId`, so a
//     caller could start a verification labelled with ANOTHER user's id;
//   - Persona's embedded web flow creates inquiries in the browser from a
//     public template id, with whatever `referenceId` the page passes.
// Either way a signed, genuine provider event could set the KYC status of an
// account that never started that verification.
//
// THE BINDING. When OUR server creates a session for an authenticated user, it
// records provider session id -> user id here. A webhook applies a result only
// to the user recorded for that session id, and only when the reference the
// event carries (if any) agrees. A session this server did not create for a
// user has no binding and changes nothing: fail closed.
//
// KV, not Postgres: a lost binding (eviction/expiry) means a verification has
// to be restarted, never that a result lands on the wrong account.
// ---------------------------------------------------------------------------

export type KycProvider = "persona" | "sumsub";

// Long enough for manual review queues; a verification still open after this
// is restarted rather than applied.
const BINDING_TTL_SECONDS = 60 * 60 * 24 * 30;

const key = (provider: KycProvider, sessionId: string) => `kyc:binding:${provider}:${sessionId}`;

/** Record that `sessionId` was created by this server for `userId`. Throws if it cannot be stored. */
export async function bindKycSession(provider: KycProvider, sessionId: string, userId: string): Promise<void> {
  if (!sessionId || !userId) throw new Error("kyc binding requires a session id and a user id");
  await kvSet(key(provider, sessionId), { userId, boundAt: Date.now() }, BINDING_TTL_SECONDS);
}

export type KycBindingResolution =
  | { ok: true; userId: string }
  | { ok: false; reason: "missing_session_id" | "unbound_session" | "reference_mismatch" };

/**
 * The user a provider result may be applied to, or why none may.
 *
 * `claimedReference` is the reference carried in the event. It is never used to
 * FIND the user — only checked against the binding, so a session relabelled with
 * someone else's id is refused rather than trusted.
 */
export async function resolveKycSession(
  provider: KycProvider,
  sessionId: string | undefined | null,
  claimedReference: string | undefined | null
): Promise<KycBindingResolution> {
  if (!sessionId) return { ok: false, reason: "missing_session_id" };
  const bound = await kvGet<{ userId: string }>(key(provider, sessionId));
  if (!bound?.userId) return { ok: false, reason: "unbound_session" };
  if (claimedReference && claimedReference !== bound.userId) {
    return { ok: false, reason: "reference_mismatch" };
  }
  return { ok: true, userId: bound.userId };
}
