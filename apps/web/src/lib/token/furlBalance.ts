// ---------------------------------------------------------------------------
// FURL balance reads.
//
// THREE DISTINCT ANSWERS, never collapsed:
//   ok + rawAmount "0"   the address genuinely holds no FURL
//   ok + rawAmount > 0   the address holds that much, at that slot
//   !ok                  we could not find out; the caller must say so
//
// Telling someone they hold nothing because a node timed out is a false
// statement about their money, so nothing here ever invents a zero.
//
// WHY A MINT-FILTERED READ RATHER THAN lib/onchain/balances.ts. That module
// answers "what does this owner hold", which means querying both token programs
// and merging. For ONE known mint the correct query is the mint filter itself:
//   * one RPC call instead of three, so there is no partial-success state where
//     one leg fails and the merged result looks merely empty — the exact failure
//     that module had to be fixed for;
//   * the filter is program-agnostic, so it cannot be wrong about FURL being
//     Token-2022;
//   * the mint is pinned in code, so no caller can redirect the read at a
//     lookalike token and have the result rendered as a FURL balance.
// The shared JSON-RPC transport (timeout, no-store, error shape) is still
// reused, so there is only one place those behaviours are defined.
// ---------------------------------------------------------------------------

import { solanaRpc, solanaRpcCall, type BalanceError } from "@/lib/onchain/balances";
import {
  FURL_MINT,
  FURL_DECIMALS,
  baseUnitsToFurl,
  isSolanaAddress,
  isFurlMint,
} from "@/lib/token/furl";

/** `decimals_mismatch` is its own failure: the chain reported a FURL account
 *  whose scale is not 6. That would make every amount we computed wrong by a
 *  power of ten, so we refuse to report a balance at all. */
export type FurlBalanceError = BalanceError | "decimals_mismatch";

export type FurlBalanceResult =
  | {
      ok: true;
      owner: string;
      mint: string;
      /** Base units (u64) as a decimal string. Never a JS number. */
      rawAmount: string;
      /** Whole FURL as a decimal string, derived from rawAmount by integer math. */
      amount: string;
      decimals: number;
      /** Slot the read was taken at — the receipt for the number. */
      slot: number | null;
      readAt: string;
      /** How many token accounts of this mint the owner has. An owner can hold
       *  FURL across several accounts (the ATA plus any auxiliary ones), and
       *  reporting only the first would under-report the balance. */
      accounts: number;
    }
  | { ok: false; error: FurlBalanceError; detail: string };

interface TokenAccountsByOwner {
  value: {
    pubkey?: string;
    account?: {
      data?: {
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: { amount?: string; decimals?: number };
          };
        };
      };
    };
  }[];
  context?: { slot?: number };
}

/**
 * FURL balance for one owner address.
 *
 * The mint is NOT a parameter — see the header.
 */
export async function readFurlBalance(owner: string): Promise<FurlBalanceResult> {
  if (!isSolanaAddress(owner)) {
    return { ok: false, error: "invalid_address", detail: "Owner is not a valid Solana address" };
  }

  const url = solanaRpc();
  if (!url) {
    return { ok: false, error: "not_configured", detail: "SOLANA_RPC_URL is not set" };
  }

  let res: TokenAccountsByOwner;
  try {
    res = await solanaRpcCall<TokenAccountsByOwner>(url, "getTokenAccountsByOwner", [
      owner,
      { mint: FURL_MINT },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
  } catch (e) {
    return {
      ok: false,
      error: "rpc_error",
      detail: e instanceof Error ? e.message : "RPC call failed",
    };
  }

  if (!Array.isArray(res.value)) {
    return { ok: false, error: "rpc_error", detail: "getTokenAccountsByOwner returned no array" };
  }

  const slot = res.context?.slot ?? null;
  const readAt = new Date().toISOString();

  let total = 0n;
  let accounts = 0;

  for (const entry of res.value) {
    const info = entry.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amount = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;

    // An account the RPC returned under a mint filter but that does not parse is
    // NOT treated as empty — it is a read we did not understand.
    if (!mint || amount == null || decimals == null) {
      return {
        ok: false,
        error: "rpc_error",
        detail: "A FURL token account did not parse; refusing to report a partial balance",
      };
    }
    // Defence in depth: the filter is by mint, but this is the boundary where a
    // wrong mint would start being called "FURL".
    if (!isFurlMint(mint)) continue;
    if (decimals !== FURL_DECIMALS) {
      return {
        ok: false,
        error: "decimals_mismatch",
        detail: `FURL account reports ${decimals} decimals, expected ${FURL_DECIMALS}`,
      };
    }
    total += BigInt(amount);
    accounts += 1;
  }

  // No matching account = a genuine zero. The owner has never held FURL, or
  // closed the account. Distinct from every failure above.
  return {
    ok: true,
    owner,
    mint: FURL_MINT,
    rawAmount: total.toString(),
    amount: baseUnitsToFurl(total),
    decimals: FURL_DECIMALS,
    slot,
    readAt,
    accounts,
  };
}

/**
 * Can this balance cover `requiredBaseUnits`?
 *
 * bigint comparison, never float. A FURL amount at 6 decimals exceeds
 * Number.MAX_SAFE_INTEGER above ~9.0 billion base units (9,007 FURL), so a
 * float comparison would start approving payments the balance cannot cover
 * somewhere in the thousands — well inside real amounts.
 */
export function hasSufficientFurl(
  balance: FurlBalanceResult,
  requiredBaseUnits: bigint,
): { ok: true } | { ok: false; reason: "insufficient_balance" | "balance_unknown"; detail: string } {
  if (requiredBaseUnits <= 0n) {
    return { ok: false, reason: "insufficient_balance", detail: "Required amount must be positive" };
  }
  // An unreadable balance is NOT a pass. Letting a payment through because we
  // could not check is how an unfunded transaction reaches a user's wallet for
  // signing and then fails at the network, after they have approved it.
  if (!balance.ok) {
    return { ok: false, reason: "balance_unknown", detail: `Balance unavailable: ${balance.detail}` };
  }
  const held = BigInt(balance.rawAmount);
  if (held < requiredBaseUnits) {
    return {
      ok: false,
      reason: "insufficient_balance",
      detail: `Holds ${baseUnitsToFurl(held)} FURL, needs ${baseUnitsToFurl(requiredBaseUnits)} FURL`,
    };
  }
  return { ok: true };
}
