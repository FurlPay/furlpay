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
  source: "travala" | "demo";
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
  createdAt: string;
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
  /** Developer wallet that receives the 7% cbBTC rebate split. */
  developerWallet?: string;
  /** Override fetch (Node 18+ has a global fetch). */
  fetchImpl?: typeof fetch;
}
