import { Authorization, BookingSource } from "./types";

/**
 * FurlPay payment side of the composition. Produces the credential a booking
 * needs, per route:
 *
 *   - travala (crypto-native): an x402 payment proof, settled in gasless USDC on
 *     Base — the rail Travala's protocol accepts directly.
 *   - legacy (Web2 merchants like Airbnb/Skyscanner): a single-use Visa virtual
 *     card number, MCC-locked to travel and limited to the booking total.
 *
 * With no FurlPay key set, both routes simulate (no network) so the flow is fully
 * runnable offline. Card PANs are never real in demo mode.
 */

const DEFAULT_BASE = "https://api.furlpay.com/v1";

// Common travel MCCs. 7011 = Lodging/Hotels, 4511 = Airlines, 7512 = Car Rental,
// 4722 = Travel Agencies.
export const MCC = { LODGING: "7011", AIRLINES: "4511", CAR_RENTAL: "7512", TRAVEL_AGENCY: "4722" } as const;

function rid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export class FurlPayPay {
  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl: string = process.env.FURLPAY_API_BASE || DEFAULT_BASE,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  get live(): boolean {
    return Boolean(this.apiKey);
  }

  /** Authorize a booking on the chosen route, returning the payment credential. */
  async authorize(params: {
    route: BookingSource;
    amountUsd: number;
    currency?: string;
    mcc?: string;
  }): Promise<Authorization> {
    const currency = (params.currency ?? "USDC").toUpperCase();
    if (params.route === "travala") return this.authorizeX402(params.amountUsd, currency);
    return this.issueVirtualCard(params.amountUsd, currency, params.mcc ?? MCC.LODGING);
  }

  private async authorizeX402(amountUsd: number, currency: string): Promise<Authorization> {
    if (!this.live) {
      return {
        route: "travala",
        amount: amountUsd,
        currency,
        x402: { proof: rid("x402_sim_"), network: "base", token: "USDC", settlementTx: rid("tx_sim_") },
        simulated: true,
      };
    }
    const settled = await this.post("/x402/settle", { amount: amountUsd, token: "USDC", destination: "travala" });
    return {
      route: "travala",
      amount: amountUsd,
      currency,
      x402: {
        proof: settled.payment_header || settled.proof,
        network: settled.network || "base",
        token: "USDC",
        settlementTx: settled.tx,
      },
    };
  }

  private async issueVirtualCard(amountUsd: number, currency: string, mcc: string): Promise<Authorization> {
    if (!this.live) {
      const last4 = String(1000 + Math.floor(Math.random() * 9000)).slice(-4);
      return {
        route: "legacy",
        amount: amountUsd,
        currency,
        card: {
          id: rid("card_sim_"),
          last4,
          expMonth: 12,
          expYear: new Date().getUTCFullYear() + 3,
          mccWhitelist: [mcc],
          singleUse: true,
          limitUsd: amountUsd,
        },
        simulated: true,
      };
    }
    const card = await this.post("/cards", {
      type: "virtual",
      currency,
      limit: amountUsd,
      mcc_whitelist: [mcc],
      single_use: true,
    });
    return {
      route: "legacy",
      amount: amountUsd,
      currency,
      card: {
        id: card.id,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
        mccWhitelist: card.mcc_whitelist ?? [mcc],
        singleUse: true,
        limitUsd: amountUsd,
      },
    };
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json.error || `FurlPay HTTP ${res.status}`);
    return json;
  }
}
