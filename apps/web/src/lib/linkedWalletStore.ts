import { sbRpc, sbSelect, SupabaseFunctionMissing, supabaseBackend } from "@/lib/supabase";
import { findUserByLinkedWallet, getAccount, type LinkedWallet } from "@/lib/store";

// ---------------------------------------------------------------------------
// Durable linked-wallet uniqueness (Phase 1 hardening).
//
// The invariant — one active normalized EVM address per account — is enforced
// by the Postgres UNIQUE constraint in migration 0005 via the atomic
// link_wallet() RPC. That is the authority in production and is race-safe
// across serverless instances. When Supabase isn't configured (demo mode) or
// the migration hasn't been applied, we fall back to the in-memory store's
// best-effort check — correct for a single instance, which is all the demo is.
// ---------------------------------------------------------------------------

export type LinkOutcome =
  | "linked" // first successful link
  | "idempotent" // same user + same address, already linked
  | "conflict_address" // address already linked to a DIFFERENT account
  | "conflict_user_has_wallet"; // this user already linked a DIFFERENT address

/**
 * Atomically claim `address` for `userId`. Returns the outcome; on `linked` or
 * `idempotent` the caller should also cache it in the in-memory user record.
 * Address comparison is on the lowercased form so casing can never bypass
 * uniqueness; the EIP-55 display form is stored separately.
 */
/**
 * Correct a mislabelled conflict from link_wallet().
 *
 * The RPC's `unique_violation` handler re-resolves against `address_norm`
 * only. When the violation actually came from `linked_wallets_user_key` — this
 * user already has a DIFFERENT wallet, inserted by a concurrent request — that
 * lookup finds no row, `v_existing_user` is NULL, and the function falls
 * through to 'conflict_address'.
 *
 * The outcome is still a rejection, so nothing unsafe happens: the fix is
 * about telling the user the truth. "That wallet belongs to another account"
 * sends someone hunting for an imaginary duplicate account, when the real
 * answer is "you already linked a different wallet — unlink it first".
 *
 * Corrected here rather than in SQL because the fix must not require a new
 * migration. This runs only on the conflict path, so it costs one extra read
 * in a case that is already terminal.
 */
async function disambiguateConflict(
  outcome: LinkOutcome,
  userId: string,
  norm: string,
): Promise<LinkOutcome> {
  if (outcome !== "conflict_address") return outcome;

  const current = getAccount(userId)?.user.linkedWallet;
  if (current && current.address.toLowerCase() !== norm) {
    return "conflict_user_has_wallet";
  }

  // The address genuinely belongs to someone else, or we cannot tell — either
  // way the original rejection stands. Fail closed.
  return outcome;
}

export async function linkWalletDurable(
  userId: string,
  addressDisplay: string,
  nonce: string
): Promise<LinkOutcome> {
  const norm = addressDisplay.toLowerCase();

  if (supabaseBackend === "supabase") {
    try {
      const outcome = await sbRpc<string>("link_wallet", {
        p_user_id: userId,
        p_address_norm: norm,
        p_address: addressDisplay,
        p_nonce: nonce,
      });
      return disambiguateConflict(outcome as LinkOutcome, userId, norm);
    } catch (e) {
      if (!(e instanceof SupabaseFunctionMissing)) throw e; // real DB error -> fail closed upstream
      // migration not applied yet -> fall through to in-memory
    }
  }
  return linkWalletInMemory(userId, norm);
}

/** In-memory equivalent (single-instance only) for demo mode / pre-migration. */
function linkWalletInMemory(userId: string, norm: string): LinkOutcome {
  const other = findUserByLinkedWallet(norm);
  if (other && other.user.id !== userId) return "conflict_address";
  const current = getAccount(userId)?.user.linkedWallet;
  if (current) {
    return current.address.toLowerCase() === norm ? "idempotent" : "conflict_user_has_wallet";
  }
  return "linked";
}

interface LinkedWalletRow {
  address: string;
  proof_nonce: string;
  linked_at: string;
}

/**
 * Who owns this address — resolved DURABLY (audit P1-12).
 *
 * The deposit webhook used findUserByLinkedWallet, which scans only accounts
 * loaded into THIS instance: a deposit for anyone else got a 200
 * "ignored_address", the provider stopped retrying, and the deposit was never
 * recorded. This reads the indexed primary key (linked_wallets.address_norm).
 *
 *   owner found            → their user id
 *   genuinely not linked   → null (a legitimate "not ours")
 *   database unavailable   → THROWS, so the caller answers 5xx and the
 *                            provider retries — never a silent "ignored"
 */
export async function findLinkedWalletOwner(address: string): Promise<string | null> {
  const norm = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(norm)) return null;
  if (supabaseBackend !== "supabase") {
    // Dev/test with no database: the in-memory index is the only copy.
    return findUserByLinkedWallet(norm)?.user.id ?? null;
  }
  const rows = await sbSelect<{ user_id: string }>(
    "linked_wallets",
    `address_norm=eq.${norm}&status=eq.active&select=user_id&limit=1`
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Read a user's current link, hydrating from Postgres on a cold instance whose
 * in-memory user record predates the link. Falls back to the in-memory copy in
 * demo mode / when the migration is absent.
 */
export async function loadLinkedWallet(userId: string): Promise<LinkedWallet | null> {
  const cached = getAccount(userId)?.user.linkedWallet ?? null;
  if (supabaseBackend !== "supabase") return cached;
  try {
    const rows = await sbRpc<LinkedWalletRow[]>("get_linked_wallet", { p_user_id: userId });
    const r = rows?.[0];
    if (!r) return cached;
    return {
      address: r.address,
      chainFamily: "evm",
      verificationMethod: "eip191",
      verifiedAt: r.linked_at,
      linkVersion: 1,
      status: "active",
      proofNonce: r.proof_nonce,
    };
  } catch (e) {
    if (e instanceof SupabaseFunctionMissing) return cached;
    throw e;
  }
}
