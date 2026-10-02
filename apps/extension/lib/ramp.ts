// ---------------------------------------------------------------------------
// Buy / sell crypto from the popup — the testable half of RampPanel.
//
// Same rules as the native app (native-app/lib/ramp.ts): the checkout is
// Coinbase's hosted page, opened in a NEW TAB, never framed; the user is told
// it is Coinbase; quotes carry their source; no status is polled because
// FurlPay receives none (the USDC shows up in the wallet when it lands).
//
// THE ONE EXTENSION-SPECIFIC CONTROL. The background opens whatever URL the
// API returns. A compromised or misconfigured API base would turn that into a
// one-click phishing tab, so the URL must be https on Coinbase's checkout host
// before a tab is created — anything else is refused, not opened.
// ---------------------------------------------------------------------------

export const RAMP_FIATS = ["USD", "EUR", "GBP"] as const;
export type RampFiat = (typeof RAMP_FIATS)[number];
export const RAMP_CHAINS = ["base", "arbitrum"] as const;
export type RampChain = (typeof RAMP_CHAINS)[number];

export interface RampQuote {
  source: "coinbase" | "demo_schedule";
  company?: string;
  cryptoAmount: number;
  fees: { network: number; processing: number; total: number };
}

export interface HostedCheckout {
  provider: "coinbase";
  url: string;
}

const CHECKOUT_HOSTS = new Set(["pay.coinbase.com"]);

/** True only for an https URL on a known provider checkout host. */
export function isTrustedCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && CHECKOUT_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function parseRampAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 50_000 ? n : null;
}

export function quoteSourceLabel(q: Pick<RampQuote, "source" | "company">): string {
  return q.source === "coinbase"
    ? `Quote from ${q.company ?? "Coinbase"}. The final amount is confirmed on its checkout.`
    : "Demo estimate, not a real price. No provider is connected on this build.";
}

/**
 * The background passes failures as the server's `error` field (lib/api.ts),
 * so this keys on codes. Step-up failures arrive as the policy sentence
 * ("... requires step-up MFA"), matched loosely on purpose.
 */
export function rampErrorMessage(code: string, direction: "buy" | "sell"): string {
  const verb = direction === "buy" ? "Buying" : "Selling";
  if (/step-up/i.test(code)) {
    return "This amount needs an extra security check. Complete it on furlpay.com, or use a smaller amount.";
  }
  switch (code) {
    case "not_available":
      return `${verb} crypto isn't available yet.`;
    case "kyc_required":
      return "Verify your identity on furlpay.com first.";
    case "region_blocked":
      return "This service is not available in your region.";
    case "velocity_exceeded":
      return "Too many purchases in a short time. Try again later.";
    case "country_unknown":
      return "We couldn't determine your country, so we can't show a provider for it.";
    case "not_quotable":
      return "Coinbase doesn't offer this combination. Try another network.";
    case "quote_unavailable":
    case "provider_error":
      return "Coinbase couldn't respond just now. Nothing was charged.";
    case "step_up_required":
      return "This needs an extra verification step.";
    case "untrusted_checkout_url":
      return "The checkout link didn't point to Coinbase, so it was not opened.";
    default:
      return /^HTTP 429$/.test(code) ? "Too many requests. Wait a minute." : "Something went wrong. Nothing was charged.";
  }
}
