import { api, ApiError, NetworkError, TimeoutError } from "../api";
import { isValidSolanaAddress } from "./wallet";

// ---------------------------------------------------------------------------
// FURL balance for the device's Solana account.
//
// READS THROUGH THE FURLPAY API, not a public RPC, on purpose:
//   * no RPC endpoint or key is shipped in the app bundle, where anyone can
//     extract it and spend someone else's rate limit;
//   * the MINT is pinned server-side (apps/web/src/app/api/token/furl/balance),
//     so nothing the app sends can point the read at a lookalike token and have
//     the result rendered as a FURL balance;
//   * one implementation of the zero-vs-unreadable distinction, shared with web.
//
// THREE OUTCOMES, KEPT APART. "You hold no FURL", "we could not check", and
// "this device has no Solana account yet" are different facts, and a balance
// screen that flattens them tells the user something false about their money.
// The server answers 503 rather than 0 when the chain is unreadable, and this
// module preserves that distinction instead of catching it into a zero.
// ---------------------------------------------------------------------------

/** FURL is a Token-2022 mint with 6 decimals. Mirrors lib/token/furl.ts on web. */
export const FURL_DECIMALS = 6;
export const FURL_SYMBOL = "FURL";

export type FurlBalance =
  | {
      ok: true;
      /** Base units (u64) as a decimal string. Never a JS number. */
      rawAmount: string;
      /** Whole FURL as a decimal string. */
      amount: string;
      /** Slot the read was taken at — the receipt for the number. */
      slot: number | null;
      readAt: string;
    }
  | { ok: false; reason: "no_account" | "unavailable" | "invalid_address"; detail: string };

interface BalanceResponse {
  ok?: boolean;
  rawAmount?: string;
  amount?: string;
  slot?: number | null;
  readAt?: string;
}

/**
 * Read the FURL balance for `owner`.
 *
 * Pass the device's Solana address (`getKnownSolanaAddress()`); `null` means the
 * wallet predates Solana support and needs one gated read to backfill, which is
 * reported as `no_account` rather than as an empty balance.
 */
export async function readFurlBalance(owner: string | null): Promise<FurlBalance> {
  if (!owner) {
    return {
      ok: false,
      reason: "no_account",
      detail: "This device has no Solana account yet. Unlock your wallet to create one.",
    };
  }
  if (!isValidSolanaAddress(owner)) {
    return { ok: false, reason: "invalid_address", detail: "Not a valid Solana address." };
  }

  try {
    const res = await api<BalanceResponse>(
      `/token/furl/balance?owner=${encodeURIComponent(owner)}`,
    );
    if (!res?.ok || typeof res.rawAmount !== "string" || typeof res.amount !== "string") {
      // A 200 whose shape we do not recognise is NOT a zero balance.
      return {
        ok: false,
        reason: "unavailable",
        detail: "The balance service returned an unexpected response.",
      };
    }
    return {
      ok: true,
      rawAmount: res.rawAmount,
      amount: res.amount,
      slot: res.slot ?? null,
      readAt: res.readAt ?? new Date().toISOString(),
    };
  } catch (e) {
    // Every failure path lands on `unavailable`. None of them becomes "0 FURL".
    if (e instanceof ApiError) {
      return {
        ok: false,
        reason: "unavailable",
        detail:
          e.status === 503
            ? "Solana could not be reached just now. Your balance is unchanged — this is a read failure, not a zero balance."
            : `Balance unavailable (${e.status}).`,
      };
    }
    if (e instanceof TimeoutError) {
      return { ok: false, reason: "unavailable", detail: "The balance request timed out." };
    }
    if (e instanceof NetworkError) {
      return { ok: false, reason: "unavailable", detail: "No connection. Balance not checked." };
    }
    return {
      ok: false,
      reason: "unavailable",
      detail: e instanceof Error ? e.message : "Balance request failed.",
    };
  }
}

/**
 * Format a FURL amount for display.
 *
 * Takes the decimal STRING the API returns, never a number: at 6 decimals a
 * FURL amount passes Number.MAX_SAFE_INTEGER in base units around 9,007 FURL,
 * so parsing the raw amount as a float loses value inside ordinary balances.
 */
export function formatFurl(amount: string, maxFractionDigits = 4): string {
  const [whole = "0", frac = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}
