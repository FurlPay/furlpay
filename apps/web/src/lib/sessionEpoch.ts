import { getAccount, getAccountDurable, persistAccount } from "@/lib/store";

// ---------------------------------------------------------------------------
// Per-user session epoch — O(1) "sign out everywhere".
//
// THE GAP THIS CLOSES: `revokeSession(jti)` kills ONE session. So a user who
// disabled MFA, or whose account was compromised, left every other device signed
// in — the laptop at the office, the tablet, the attacker's stolen cookie — until
// natural expiry. That is the opposite of what a credential change should mean,
// and NIST SP 800-63B-4's authenticator-event guidance is explicit that loss,
// theft or compromise must be able to terminate sessions.
//
// Blacklisting every outstanding jti instead would need an unbounded, per-token
// set that has to be consulted on every request and can never be safely pruned.
// A single counter compared against a claim is O(1) and needs no bookkeeping.
//
// WHY NOT KV. The obvious implementation is `kvIncr("auth:epoch:" + id)`, and it
// is wrong here: `kvIncr` in this codebase takes a WINDOW and sets a TTL
// (lib/kv.ts) because it exists for rate limiting. An epoch that expires SILENTLY
// REVIVES every token it revoked — the counter drops back to 1, old claims match
// again, and the attacker's session works. Revocation must be durable, so the
// epoch lives on the account record alongside the rest of the security state and
// is persisted through the same write-through path.
//
// MIGRATION. Tokens minted before this existed carry no epoch, and accounts
// created before it have none either. Both default to 1, so they match and every
// live session keeps working. Only an actual bump invalidates anything — the
// rollout cannot log the whole user base out.
// ---------------------------------------------------------------------------

/** Header naming why a 401 happened, so a client can re-auth instead of retrying. */
export const REVOCATION_HEADER = "X-Revocation-Reason";
export const EPOCH_OUTDATED = "session_epoch_outdated";

/** Absent epoch means "never bumped". */
const DEFAULT_EPOCH = 1;

export function epochOf(account: { user: { security: { sessionEpoch?: number } } }): number {
  const raw = account.user.security.sessionEpoch;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_EPOCH;
}

/**
 * Does this token's epoch still match the account's?
 *
 * Both sides default to 1, so a legacy token against a legacy account passes.
 */
export function epochMatches(
  claimed: number | undefined,
  account: { user: { security: { sessionEpoch?: number } } }
): boolean {
  const tokenEpoch =
    typeof claimed === "number" && Number.isFinite(claimed) && claimed >= 1 ? claimed : DEFAULT_EPOCH;
  return tokenEpoch === epochOf(account);
}

/**
 * The epoch a NEWLY MINTED token must carry.
 *
 * Every login path has to stamp this. Without it a fresh token defaults to 1,
 * and once an account has been bumped to 2 the user could authenticate
 * successfully and then be rejected on their very next request — locked out of
 * their own account by the revocation feature. Returns 1 when the account cannot
 * be resolved, which matches the never-bumped default.
 */
export async function currentEpoch(userId: string): Promise<number> {
  const account = (await getAccountDurable(userId)) ?? getAccount(userId);
  return account ? epochOf(account) : DEFAULT_EPOCH;
}

/**
 * Invalidate every session for this user, including the caller's.
 *
 * Returns the new epoch so the caller can re-issue a cookie for the device that
 * performed the action — otherwise "disable MFA" would sign the user out of the
 * tab they are looking at, which reads as a bug and pushes them to re-auth for
 * no security gain. Every OTHER device is now rejected on its next request.
 *
 * Persists before returning: an epoch that is bumped in memory and lost on a
 * failed write is a revocation the user was told happened and did not.
 */
export async function bumpSessionEpoch(userId: string): Promise<number> {
  // Durable read first — a cold instance may not have this account in memory,
  // and bumping a stale copy would lower the epoch and un-revoke tokens.
  const account = (await getAccountDurable(userId)) ?? getAccount(userId);
  if (!account) throw new Error(`cannot bump session epoch: no account ${userId}`);

  const next = epochOf(account) + 1;
  account.user.security.sessionEpoch = next;
  await persistAccount(userId);
  return next;
}
