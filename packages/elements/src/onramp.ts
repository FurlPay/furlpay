// ---------------------------------------------------------------------------
// @furlpay/elements/onramp — HEADLESS on-ramp SDK. Unlike the React widgets in
// index.tsx, this ships no UI: partners drive their own checkout (Apple Pay,
// card fields, native buttons) and call these functions to quote and create
// on-ramp sessions. Every dApp becomes a FurlPay on-ramp without a redirect.
//
// Framework-agnostic (plain fetch) so it runs in React, Vue, Node or an edge
// worker. The publishable key scopes the session; settlement + KYC happen
// server-side. Mirrors MoonPay Headless / Transak Stream.
// ---------------------------------------------------------------------------

export type OnrampToken = "USDC" | "USDT" | "EURC" | "PYUSD";
export type OnrampChain = "arbitrum" | "base" | "polygon" | "solana";
export type OnrampPaymentMethod = "card" | "apple_pay" | "google_pay" | "sepa" | "ach";

export interface OnrampQuoteParams {
  /** Fiat amount to spend, in `fiatCurrency`. */
  fiatAmount: number;
  fiatCurrency?: string; // ISO 4217, default USD
  token?: OnrampToken; // default USDC
  chain?: OnrampChain; // default arbitrum
  paymentMethod?: OnrampPaymentMethod; // default card
}

export interface OnrampQuote {
  fiatAmount: number;
  fiatCurrency: string;
  token: OnrampToken;
  chain: OnrampChain;
  /** Net crypto the user receives after fees. */
  cryptoAmount: number;
  exchangeRate: number;
  fees: { network: number; processing: number; total: number };
  paymentMethod: OnrampPaymentMethod;
  expiresAt: string;
}

export interface OnrampSessionParams extends OnrampQuoteParams {
  /** Destination wallet the crypto is delivered to. */
  destinationAddress: string;
  /** Where to return the user after the payment sheet closes (optional). */
  redirectUrl?: string;
  /** Opaque reference echoed back on webhooks. */
  externalId?: string;
}

export interface OnrampSession {
  id: string;
  status: "requires_payment" | "processing" | "completed" | "failed";
  quote: OnrampQuote;
  destinationAddress: string;
  /** Client secret the partner's payment sheet uses to confirm (headless). */
  clientSecret: string;
  createdAt: string;
  /** FurlPay ramp order id (when a provider checkout was opened). Status: GET /api/ramp/orders/:id. */
  orderId?: string | null;
  /** The provider-hosted checkout to send the customer to. The page is the provider's, under its terms. */
  hosted?: { provider: string; url: string } | null;
}

export interface OnrampClientOptions {
  /** Publishable key (pk_...). */
  publishableKey: string;
  /** FurlPay API base. Default https://api.furlpay.com. */
  baseUrl?: string;
  /** Inject a custom fetch (SSR / tests). */
  fetchImpl?: typeof fetch;
}

export interface OnrampClient {
  quote(params: OnrampQuoteParams): Promise<OnrampQuote>;
  createSession(params: OnrampSessionParams): Promise<OnrampSession>;
  getSession(id: string): Promise<OnrampSession>;
}

const DEFAULT_BASE = "https://api.furlpay.com";

/** Create a headless on-ramp client. */
export function createOnramp(opts: OnrampClientOptions): OnrampClient {
  if (!opts.publishableKey || !opts.publishableKey.startsWith("pk_")) {
    throw new Error("createOnramp: a publishable key (pk_...) is required");
  }
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const doFetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
  if (!doFetch) throw new Error("createOnramp: no fetch implementation available");

  async function call<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const res = await doFetch!(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.publishableKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`FurlPay on-ramp ${res.status}: ${detail || res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    quote: (params) =>
      call<OnrampQuote>("/api/onramp/quote", "POST", normalizeQuote(params)),
    createSession: (params) => {
      if (!params.destinationAddress) {
        throw new Error("createSession: destinationAddress is required");
      }
      return call<OnrampSession>("/api/onramp/session", "POST", {
        ...normalizeQuote(params),
        destinationAddress: params.destinationAddress,
        redirectUrl: params.redirectUrl,
        externalId: params.externalId,
      });
    },
    getSession: (id) => call<OnrampSession>(`/api/onramp/session/${encodeURIComponent(id)}`, "GET"),
  };
}

function normalizeQuote(p: OnrampQuoteParams) {
  if (!(p.fiatAmount > 0)) throw new Error("fiatAmount must be positive");
  return {
    fiatAmount: p.fiatAmount,
    fiatCurrency: (p.fiatCurrency || "USD").toUpperCase(),
    token: p.token || "USDC",
    chain: p.chain || "arbitrum",
    paymentMethod: p.paymentMethod || "card",
  };
}
