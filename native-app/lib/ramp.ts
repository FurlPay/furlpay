// ---------------------------------------------------------------------------
// Buy / sell crypto (on-ramp, off-ramp) — the logic behind app/ramp.tsx, kept
// out of the screen so it can be tested without a renderer.
//
// WHO HOLDS THE MONEY. Every live path here is a provider's hosted checkout:
// Coinbase takes the card or bank payment, runs its own KYC and delivers USDC
// to the user's own wallet address. FurlPay never touches the fiat. The screen
// says so by name — internally the partner is "furlgateway", but a user paying
// Coinbase must be told it is Coinbase.
//
// WHAT IS NOT HERE, ON PURPOSE.
//   - No status polling. /api/onramp/session/:id is an in-memory record nothing
//     updates; polling it would show "requires payment" forever. The truth is
//     on-chain: the USDC lands in the wallet and shows in the balance.
//   - No bank-account form. /api/offramp/beneficiary refuses (503) until a
//     verification partner exists; the screen reads `available` and says so.
//   - No fabricated price. A quote is Coinbase's (`source: "coinbase"`) or a
//     clearly labelled demo estimate outside production; production with no
//     provider is a 503 and the screen shows "not available".
// ---------------------------------------------------------------------------

import { ApiError } from "./api";

export const RAMP_FIATS = ["USD", "EUR", "GBP"] as const;
export type RampFiat = (typeof RAMP_FIATS)[number];

/** EVM chains the device wallet's one address is valid on, that Coinbase delivers to. */
export const RAMP_CHAINS = ["base", "arbitrum"] as const;
export type RampChain = (typeof RAMP_CHAINS)[number];

export const RAMP_MIN = 1;
export const RAMP_MAX = 50_000;
/** Wait this long after the last keystroke before quoting. */
export const QUOTE_DEBOUNCE_MS = 500;

export interface RampQuote {
  source: "coinbase" | "demo_schedule";
  company?: string;
  quoteId?: string;
  fiatAmount: number;
  fiatCurrency: string;
  token: string;
  chain: string;
  cryptoAmount: number;
  fees: { network: number; processing: number; total: number };
  paymentTotal?: { value: string; currency: string };
}

export interface HostedCheckout {
  provider: "coinbase";
  url: string;
  feeNote: string;
  expiresNote: string;
}

/** Parse what the user typed. Null when it is not a quotable amount. */
export function parseRampAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= RAMP_MIN && n <= RAMP_MAX ? n : null;
}

/** The provenance line under a quote. Never blank: a number without a source reads as a promise. */
export function quoteSourceLabel(q: Pick<RampQuote, "source" | "company">): string {
  return q.source === "coinbase"
    ? `Quote from ${q.company ?? "Coinbase"}. The final amount is confirmed on its checkout.`
    : "Demo estimate — not a real price. No provider is connected on this build.";
}

/** Plain-language tax note for selling. Not advice; names the one rule users most often miss. */
export const SELL_TAX_NOTE =
  "Selling crypto can be taxable. In India, 1% TDS applies to crypto transfers above the " +
  "threshold (Income-tax Act s.194S). FurlPay does not give tax advice.";

/**
 * Turn a ramp API failure into a sentence the user can act on.
 *
 * Keyed on the server's error codes, not its messages, so a reworded server
 * string never surfaces raw. Unknown failures say "try again" — never a
 * success, and never a guess at a cause.
 */
export function rampErrorMessage(e: unknown, direction: "buy" | "sell" = "buy"): string {
  if (!(e instanceof ApiError)) return "Couldn't reach FurlPay. Check your connection and try again.";
  const d = (e.data ?? {}) as { error?: string; detail?: string; stepUpRequired?: boolean };
  const verb = direction === "buy" ? "Buying" : "Selling";
  if (d.stepUpRequired) {
    return "This amount needs an extra security check that this app can't complete yet. Use a smaller amount or furlpay.com.";
  }
  switch (d.error) {
    case "not_available":
      return `${verb} crypto isn't available yet.`;
    case "kyc_required":
    case "region_blocked":
    case "velocity_exceeded":
      return d.detail ?? "This request was declined.";
    case "country_unknown":
      return "We couldn't determine your country, so we can't show a provider for it.";
    case "not_quotable":
      return "Coinbase doesn't offer this combination. Try another network or payment method.";
    case "quote_unavailable":
    case "provider_error":
      return "Coinbase couldn't respond just now. Nothing was charged. Try again.";
    case "beneficiary_verification_unavailable":
      return "Direct bank payouts aren't available yet.";
    default:
      return e.status === 429 ? "Too many requests. Wait a minute and try again." : "Something went wrong. Nothing was charged.";
  }
}
