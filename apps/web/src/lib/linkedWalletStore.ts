import { sbRpc, SupabaseFunctionMissing, supabaseBackend } from "@/lib/supabase";
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
      return outcome as LinkOutcome;
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
