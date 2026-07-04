import { FurlPayPay, MCC } from "./furlpay";
import { TravalaClient } from "./travala";
import {
  Booking,
  BookingSource,
  Flight,
  MandateVerifier,
  RebateAccrual,
  Stay,
  TravelOptions,
} from "./types";

export { MCC } from "./furlpay";
export * from "./types";

// Travala pays a 10% cbBTC developer rebate on MCP-driven bookings. We split it
// 7% to the integrating developer, 3% to the FurlPay treasury.
const REBATE_RATE = 0.1;
const DEVELOPER_SHARE = 0.7;

/**
 * FurlPay Travels — composes Travala's Travel MCP (search) with FurlPay's payment
 * rails (pay). An agent searches inventory, FurlPay checks the spend budget and
 * issues a credential (x402 proof for the Travala/Base route, or a single-use
 * MCC-locked Visa VCN for legacy merchants), and the booking accrues the 10%
 * cbBTC rebate.
 *
 * Clone-and-run: with no keys, search and payment simulate end-to-end.
 */
export class TravelClient {
  private readonly travala: TravalaClient;
  private readonly pay: FurlPayPay;
  private readonly trust?: MandateVerifier;
  private readonly developerWallet?: string;
  private readonly bookings = new Map<string, Booking>();
  /** Per-agent USDC spend caps for autonomous booking. */
  private readonly budgets = new Map<string, { limit: number; spent: number }>();

  constructor(opts: TravelOptions = {}) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.travala = new TravalaClient(
      opts.travalaMcpUrl || process.env.TRAVALA_MCP_URL,
      process.env.TRAVALA_API_KEY,
      fetchImpl,
    );
    this.pay = new FurlPayPay(
      opts.furlpayApiKey || process.env.FURLPAY_API_KEY,
      opts.furlpayBaseUrl,
      fetchImpl,
    );
    this.developerWallet = opts.developerWallet || process.env.FURLPAY_DEVELOPER_WALLET;
    this.trust = opts.trust;
  }

  get live(): boolean {
    return this.pay.live;
  }

  // -- search -------------------------------------------------------------

  searchStays(p: { city: string; checkIn: string; checkOut: string; maxNightlyUsd?: number; guests?: number }): Promise<Stay[]> {
    return this.travala.searchStays(p);
  }

  searchFlights(p: { from: string; to: string; date: string }): Promise<Flight[]> {
    return this.travala.searchFlights(p);
  }

  // -- budget policy ------------------------------------------------------

  setAgentBudget(agentId: string, limitUsd: number): void {
    const existing = this.budgets.get(agentId);
    this.budgets.set(agentId, { limit: limitUsd, spent: existing?.spent ?? 0 });
  }

  getAgentBudget(agentId: string): { limit: number; spent: number; remaining: number } {
    const b = this.budgets.get(agentId) ?? { limit: Infinity, spent: 0 };
    return { limit: b.limit, spent: b.spent, remaining: b.limit - b.spent };
  }

  // -- book ---------------------------------------------------------------

  /**
   * Authorize a booking. `source: "travala"` pays via x402/USDC on Base; any other
   * merchant uses `source: "legacy"` → a single-use MCC-locked Visa VCN.
   * Enforces the agent budget before authorizing. When a MandateVerifier is
   * configured, the booking must also present a valid `mandateToken`: the
   * signed intent must match the exact amount/mcc/source being executed, so a
   * compromised or over-eager agent cannot spend outside its user's grant.
   */
  async authorizeBooking(params: {
    amountUsd: number;
    source: BookingSource;
    currency?: string;
    mcc?: string;
    agentId?: string;
    reference?: string;
    /** TAP-style booking token from @furlpay/agent-trust createBookingToken(). */
    mandateToken?: string;
  }): Promise<Booking> {
    if (params.amountUsd <= 0) throw new Error("amountUsd must be > 0");

    const mcc = params.mcc ?? (params.source === "legacy" ? MCC.LODGING : undefined);

    let trust: Booking["trust"];
    if (this.trust) {
      if (!params.mandateToken) {
        throw new Error("mandateToken required: this server verifies agent mandates before authorizing");
      }
      const decision = await this.trust.verifyBookingToken(params.mandateToken, {
        amountUsd: params.amountUsd,
        mcc,
        source: params.source,
      });
      if (!decision.ok) throw new Error(`mandate rejected: ${decision.reason ?? "verification failed"}`);
      trust = { agentKeyId: decision.agentKeyId, mandateId: decision.mandateId, remainingUsd: decision.remainingUsd };
    }

    const agentId = params.agentId ?? "agent_default";
    const budget = this.budgets.get(agentId);
    if (budget && budget.spent + params.amountUsd > budget.limit) {
      throw new Error(
        `booking $${params.amountUsd} exceeds remaining budget $${(budget.limit - budget.spent).toFixed(2)} for ${agentId}`,
      );
    }

    const authorization = await this.pay.authorize({
      route: params.source,
      amountUsd: params.amountUsd,
      currency: params.currency,
      mcc,
    });

    const booking: Booking = {
      id: "bk_" + Math.random().toString(36).slice(2, 10),
      source: params.source,
      reference: params.reference ?? "(unassigned)",
      amountUsd: params.amountUsd,
      status: "authorized",
      authorization,
      rebate: params.source === "travala" ? this.accrueRebate("", params.amountUsd) : undefined,
      trust,
      createdAt: new Date().toISOString(),
    };
    if (booking.rebate) booking.rebate.bookingId = booking.id;

    if (budget) budget.spent += params.amountUsd;
    this.bookings.set(booking.id, booking);
    return booking;
  }

  /** Mark an authorized booking confirmed (after passkey step-up in a real flow). */
  confirmBooking(id: string): Booking {
    const b = this.require(id);
    if (b.status === "cancelled") throw new Error(`booking ${id} is cancelled`);
    b.status = "confirmed";
    return b;
  }

  cancelBooking(id: string): Booking {
    const b = this.require(id);
    b.status = "cancelled";
    const budget = this.budgets.get("agent_default");
    return b;
  }

  getBooking(id: string): Booking | undefined {
    return this.bookings.get(id);
  }

  // -- rebates ------------------------------------------------------------

  /** All cbBTC rebate accruals to date and the developer's cumulative share. */
  listRebates(): { developerWallet?: string; accruals: RebateAccrual[]; developerTotalUsd: number; treasuryTotalUsd: number } {
    const accruals = [...this.bookings.values()]
      .filter((b) => b.rebate && b.status !== "cancelled")
      .map((b) => b.rebate!) as RebateAccrual[];
    return {
      developerWallet: this.developerWallet,
      accruals,
      developerTotalUsd: round2(accruals.reduce((s, r) => s + r.developerUsd, 0)),
      treasuryTotalUsd: round2(accruals.reduce((s, r) => s + r.treasuryUsd, 0)),
    };
  }

  private accrueRebate(bookingId: string, amountUsd: number): RebateAccrual {
    const total = round2(amountUsd * REBATE_RATE);
    const developerUsd = round2(total * DEVELOPER_SHARE);
    return {
      bookingId,
      currency: "cbBTC",
      totalUsd: total,
      developerUsd,
      treasuryUsd: round2(total - developerUsd),
    };
  }

  private require(id: string): Booking {
    const b = this.bookings.get(id);
    if (!b) throw new Error(`no booking ${id}`);
    return b;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default TravelClient;
