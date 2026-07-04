export type BookingSource = "travala" | "legacy";

export interface Stay {
  quoteId: string;
  name: string;
  brand: string;
  city: string;
  stars: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  nightlyUsd: number;
  totalUsd: number;
  source: "travala" | "demo";
}

export interface Flight {
  quoteId: string;
  carrier: string;
  from: string;
  to: string;
  date: string;
  cabin: string;
  totalUsd: number;
  source: "travala" | "demo" | "duffel";
}

/** A payment authorization FurlPay hands back for a booking. */
export interface Authorization {
  route: BookingSource;
  amount: number;
  currency: string;
  /** Present on the crypto route: an x402 payment proof settled on Base. */
  x402?: { proof: string; network: string; token: string; settlementTx?: string };
  /** Present on the legacy route: a single-use Visa virtual card number, MCC-locked. */
  card?: {
    id: string;
    last4: string;
    expMonth: number;
    expYear: number;
    mccWhitelist: string[];
    singleUse: boolean;
    limitUsd: number;
  };
  simulated?: boolean;
}

export interface Booking {
  id: string;
  source: BookingSource;
  reference: string;
  amountUsd: number;
  status: "authorized" | "confirmed" | "cancelled";
  authorization: Authorization;
  /** 10% cbBTC developer rebate accrued on Travala-routed bookings. */
  rebate?: RebateAccrual;
  /** Present when a MandateVerifier gated this booking (TAP-style trust chain). */
  trust?: { agentKeyId?: string; mandateId?: string; remainingUsd?: number };
  createdAt: string;
}

/** Outcome of verifying a booking token against a user-signed mandate. */
export interface TrustDecision {
  ok: boolean;
  reason?: string;
  agentKeyId?: string;
  mandateId?: string;
  /** USD allowance left on the mandate after this booking. */
  remainingUsd?: number;
}

/**
 * TAP-style trust gate. `@furlpay/agent-trust`'s AgentTrust implements this
 * shape directly (Ed25519 identities, user-signed mandates, RFC 9421
 * signatures); any object with the same method plugs in — the package itself
 * stays zero-dependency.
 */
export interface MandateVerifier {
  verifyBookingToken(
    token: string,
    claims: { amountUsd: number; mcc?: string; source: string },
  ): TrustDecision | Promise<TrustDecision>;
}

export interface RebateAccrual {
  bookingId: string;
  currency: "cbBTC";
  totalUsd: number; // 10% of booking, expressed in USD-equivalent
  developerUsd: number; // 7%
  treasuryUsd: number; // 3%
}

export interface TravelOptions {
  /** FurlPay API key. Omit → demo mode (searches + payments simulate, no network). */
  furlpayApiKey?: string;
  /** FurlPay API base. Default https://api.furlpay.com/v1 */
  furlpayBaseUrl?: string;
  /** Travala Travel MCP endpoint. Default https://travel-mcp.travala.com/mcp */
  travalaMcpUrl?: string;
  /**
   * Duffel API token for live real-time flight search (free test tokens at
   * duffel.com — `duffel_test_…` works). When set, travel_search_flights
   * returns live Duffel offers; Travala/demo remains the fallback.
   */
  duffelApiKey?: string;
  /** Developer wallet that receives the 7% cbBTC rebate split. */
  developerWallet?: string;
  /** Override fetch (Node 18+ has a global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Optional TAP-style trust gate (e.g. `new AgentTrust()` from
   * `@furlpay/agent-trust`). When set, every authorizeBooking call MUST carry
   * a valid `mandateToken` — an agent-signed intent under a user-signed
   * mandate — before any payment credential is issued.
   */
  trust?: MandateVerifier;
}
