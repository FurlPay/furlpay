import { webhooks } from "./webhooks";
import { Balance, Card, Order, Stablecoin, SwapQuote, Wallet, Chain } from "./types";

export * from "./types";
export { webhooks };

export interface FurlpayOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The Furlpay client.
 *
 * @example
 *   import { Furlpay } from '@furlpay/furlpay-node';
 *   const furlpay = new Furlpay({ apiKey: process.env.FURLPAY_API_KEY! });
 *   const wallet = await furlpay.wallets.retrieve();
 */
export class Furlpay {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  // Static access mirrors `Stripe.webhooks.constructEvent`.
  static webhooks = webhooks;
  webhooks = webhooks;

  constructor(opts: FurlpayOptions) {
    if (!opts.apiKey) throw new Error("Furlpay: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.furlpay.app";
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("Furlpay: no fetch implementation available (Node 18+ required)");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new FurlpayError(json.error || res.statusText, res.status, json);
    }
    return json as T;
  }

  wallets = {
    retrieve: () => this.request<Wallet>("GET", "/api/wallets"),
    transfer: (params: { destination: string; amount: number; token: Stablecoin; chain: Chain; signature: string; safeAddress?: string }) =>
      this.request<{ transactionHash: string; gasSponsored: boolean }>("POST", "/api/wallets/transfer", params),
  };

  banking = {
    list: () => this.request<{ accounts: unknown[] }>("GET", "/api/banking"),
    provision: (currency: "USD" | "EUR" | "GBP" | "INR") =>
      this.request<Record<string, string>>("POST", "/api/banking", { currency }),
  };

  cards = {
    list: () => this.request<{ cards: Card[] }>("GET", "/api/cards"),
    updateSettings: (params: { cardId: string; freeze?: boolean; limits?: { daily?: number; perPurchase?: number }; priority?: string[] }) =>
      this.request<{ success: boolean; card: Card }>("POST", "/api/cards/settings", params),
  };

  investing = {
    portfolio: () => this.request<{ holdings: unknown[]; performance: unknown }>("GET", "/api/investing/portfolio"),
    createOrder: (params: { symbol: string; side: "buy" | "sell"; notional: number; type?: "market" | "limit" }) =>
      this.request<Order>("POST", "/api/investing/order", params),
  };

  swaps = {
    quote: (params: { fromToken: Stablecoin; toToken: Stablecoin; fromChain: Chain; amountIn: number; toChain?: Chain }) =>
      this.request<{ quote: SwapQuote }>("POST", "/api/swaps", params),
  };

  compliance = {
    verifyIdentity: (params: { fullName: string; dateOfBirth: string; documentNumber: string }) =>
      this.request<{ result: unknown }>("POST", "/api/compliance/kyc", params),
    travelRule: (params: unknown) =>
      this.request<{ payload: unknown }>("POST", "/api/compliance/travel-rule", params),
  };
}

export class FurlpayError extends Error {
  readonly statusCode: number;
  readonly raw: unknown;
  constructor(message: string, statusCode: number, raw: unknown) {
    super(message);
    this.name = "FurlpayError";
    this.statusCode = statusCode;
    this.raw = raw;
  }
}
