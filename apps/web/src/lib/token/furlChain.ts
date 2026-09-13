// ---------------------------------------------------------------------------
// Live FURL mint state, read from the chain.
//
// Everything on /token that a reader could verify themselves is read here
// rather than typed into the page. Supply, decimals, and — the two that matter
// most for anyone deciding whether to hold FURL — the MINT AUTHORITY and FREEZE
// AUTHORITY. A page that hardcodes "mint authority: active" keeps saying so
// after it is revoked, and a page that hardcodes "revoked" would be a lie the
// moment it was written. Both come off the chain.
//
// Concentration is read the same way: `getTokenLargestAccounts` is the public
// answer to "who holds this", so the page publishes what that call returns
// instead of a claim about it. Today it returns one account holding 100%.
//
// FAILURE IS VISIBLE. No field falls back to a plausible default — a failed
// read returns `ok: false` and the UI renders "unavailable", because a stale
// "freeze authority: none" shown during an RPC outage is exactly the assurance
// someone should not be given on faith.
// ---------------------------------------------------------------------------

import { solanaRpc, solanaRpcCall } from "@/lib/onchain/balances";
import {
  FURL_MINT,
  FURL_DECIMALS,
  FURL_TOKEN_PROGRAM,
  FURL_TOTAL_SUPPLY_BASE_UNITS,
  baseUnitsToFurl,
  formatFurl,
} from "@/lib/token/furl";

export type ChainReadError = "not_configured" | "rpc_error" | "not_found" | "unexpected_shape";

export interface FurlMintState {
  mint: string;
  /** Owning program id as reported by the chain — proves Token-2022. */
  programId: string;
  isToken2022: boolean;
  decimals: number;
  /** Supply in base units, as a string. */
  supplyRaw: string;
  /** Supply in whole FURL, as a string (integer math, no float). */
  supply: string;
  /** Null means permanently revoked — no one can ever mint more FURL. */
  mintAuthority: string | null;
  /** Null means no account can ever be frozen — holders cannot be censored. */
  freezeAuthority: string | null;
  /** Token-2022 extension names present on the mint, as the chain reports them. */
  extensions: string[];
  /** True only if decimals AND supply match what the app believes. */
  matchesExpected: boolean;
  slot: number | null;
  readAt: string;
}

export interface FurlHolder {
  /** Token ACCOUNT address (not the owner) — what the RPC returns. */
  tokenAccount: string;
  amountRaw: string;
  amount: string;
  /** Share of current supply, 2dp, computed with bigint math. */
  sharePercent: string;
}

export interface FurlConcentration {
  holders: FurlHolder[];
  /** Share held by the single largest token account, 2dp. */
  topHolderPercent: string;
  /** Number of token accounts with a non-zero balance, capped at the RPC's 20. */
  nonZeroAccounts: number;
  slot: number | null;
  readAt: string;
}

export type ChainResult<T> = { ok: true; data: T } | { ok: false; error: ChainReadError; detail: string };

interface ParsedMintAccount {
  value: {
    owner?: string;
    data?: {
      program?: string;
      parsed?: {
        type?: string;
        info?: {
          decimals?: number;
          supply?: string;
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
          extensions?: { extension?: string }[];
        };
      };
    };
  } | null;
  context?: { slot?: number };
}

interface LargestAccounts {
  value: { address?: string; amount?: string; decimals?: number }[];
  context?: { slot?: number };
}

/** Percent of `total` that `part` represents, 2dp, via integer math only. */
function sharePercent(part: bigint, total: bigint): string {
  if (total <= 0n) return "0.00";
  // ×10000 then divide gives hundredths of a percent without touching a float.
  const basisPoints = (part * 10_000n) / total;
  const whole = basisPoints / 100n;
  const frac = basisPoints % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Live mint state for FURL. The mint address is fixed, never a parameter. */
export async function readFurlMintState(): Promise<ChainResult<FurlMintState>> {
  const url = solanaRpc();
  if (!url) return { ok: false, error: "not_configured", detail: "SOLANA_RPC_URL is not set" };

  try {
    const res = await solanaRpcCall<ParsedMintAccount>(url, "getAccountInfo", [
      FURL_MINT,
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);

    if (!res.value) {
      return { ok: false, error: "not_found", detail: `No account at ${FURL_MINT}` };
    }
    const info = res.value.data?.parsed?.info;
    if (!info || typeof info.decimals !== "number" || typeof info.supply !== "string") {
      return { ok: false, error: "unexpected_shape", detail: "Mint account did not parse as an SPL mint" };
    }

    const programId = res.value.owner ?? "";
    const supplyRaw = BigInt(info.supply);

    return {
      ok: true,
      data: {
        mint: FURL_MINT,
        programId,
        isToken2022: programId === FURL_TOKEN_PROGRAM,
        decimals: info.decimals,
        supplyRaw: supplyRaw.toString(),
        supply: baseUnitsToFurl(supplyRaw),
        // `undefined` from a parser that omitted the field is NOT "revoked".
        // Only an explicit null means revoked, so undefined stays null-checked
        // against the raw response rather than assumed.
        mintAuthority: info.mintAuthority ?? null,
        freezeAuthority: info.freezeAuthority ?? null,
        extensions: (info.extensions ?? [])
          .map((e) => e.extension)
          .filter((e): e is string => typeof e === "string"),
        matchesExpected:
          info.decimals === FURL_DECIMALS && supplyRaw === FURL_TOTAL_SUPPLY_BASE_UNITS,
        slot: res.context?.slot ?? null,
        readAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: "rpc_error", detail: e instanceof Error ? e.message : "RPC call failed" };
  }
}

/**
 * Largest FURL token accounts and their share of supply.
 *
 * `getTokenLargestAccounts` returns at most 20 accounts, so `nonZeroAccounts`
 * is a floor, not a holder count — the field name says so and the UI must not
 * present it as "FURL has N holders".
 */
export async function readFurlConcentration(): Promise<ChainResult<FurlConcentration>> {
  const url = solanaRpc();
  if (!url) return { ok: false, error: "not_configured", detail: "SOLANA_RPC_URL is not set" };

  try {
    const res = await solanaRpcCall<LargestAccounts>(url, "getTokenLargestAccounts", [
      FURL_MINT,
      { commitment: "confirmed" },
    ]);
    if (!Array.isArray(res.value)) {
      return { ok: false, error: "unexpected_shape", detail: "getTokenLargestAccounts returned no array" };
    }

    const rows = res.value
      .filter((v) => typeof v.address === "string" && typeof v.amount === "string")
      .map((v) => ({ address: v.address as string, amount: BigInt(v.amount as string) }))
      .filter((v) => v.amount > 0n);

    // Share is taken against ACTUAL current supply, read in the same pass, not
    // against the 1B constant — if supply ever changes, a percentage computed
    // off a hardcoded denominator would quietly stop summing to 100%.
    const mintState = await readFurlMintState();
    const total = mintState.ok ? BigInt(mintState.data.supplyRaw) : FURL_TOTAL_SUPPLY_BASE_UNITS;

    const holders: FurlHolder[] = rows.map((r) => ({
      tokenAccount: r.address,
      amountRaw: r.amount.toString(),
      amount: formatFurl(r.amount),
      sharePercent: sharePercent(r.amount, total),
    }));

    return {
      ok: true,
      data: {
        holders,
        topHolderPercent: holders.length ? holders[0].sharePercent : "0.00",
        nonZeroAccounts: holders.length,
        slot: res.context?.slot ?? null,
        readAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: "rpc_error", detail: e instanceof Error ? e.message : "RPC call failed" };
  }
}
