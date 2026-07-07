import { randomUUID, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Headless on-ramp backend — powers @furlpay/elements/onramp. Quotes fiat→crypto
// and mints sessions partners confirm with their own payment sheet. Demo:
// deterministic FX + fee schedule, in-memory sessions. A live build routes to a
// licensed on-ramp provider (card/Apple Pay acquiring + KYC) and settles the
// crypto leg on-chain.
// ---------------------------------------------------------------------------

const FX: Record<string, number> = { USD: 1, EUR: 1.09, GBP: 1.27 };
// Token price in USD (EURC tracks EUR).
const TOKEN_USD: Record<string, number> = { USDC: 1, USDT: 1, PYUSD: 1, EURC: 1.09 };
// Processing fee by method.
const METHOD_FEE: Record<string, number> = {
  card: 0.029,
  apple_pay: 0.025,
  google_pay: 0.025,
  sepa: 0.008,
  ach: 0.008,
};
const NETWORK_FEE_USD: Record<string, number> = { arbitrum: 0.01, base: 0.01, polygon: 0.005, solana: 0.002 };

export interface QuoteInput {
  fiatAmount: number;
  fiatCurrency: string;
  token: string;
  chain: string;
  paymentMethod: string;
}

export function quoteOnramp(input: QuoteInput) {
  const fx = FX[input.fiatCurrency] ?? 1;
  const tokenUsd = TOKEN_USD[input.token] ?? 1;
  const usd = input.fiatAmount * fx;

  const processing = round(usd * (METHOD_FEE[input.paymentMethod] ?? 0.029));
  const network = NETWORK_FEE_USD[input.chain] ?? 0.01;
  const totalFees = round(processing + network);
  const netUsd = Math.max(0, usd - totalFees);
  const cryptoAmount = round(netUsd / tokenUsd);

  return {
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    token: input.token,
    chain: input.chain,
    cryptoAmount,
    exchangeRate: round(tokenUsd / fx), // token per 1 unit fiat, inverse
    fees: { network, processing, total: totalFees },
    paymentMethod: input.paymentMethod,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

export interface OnrampSessionRecord {
  id: string;
  status: "requires_payment" | "processing" | "completed" | "failed";
  quote: ReturnType<typeof quoteOnramp>;
  destinationAddress: string;
  clientSecret: string;
  externalId?: string;
  createdAt: string;
}

const g = globalThis as unknown as { __onramp?: Map<string, OnrampSessionRecord> };
const sessions = g.__onramp ?? (g.__onramp = new Map());

export function createOnrampSession(
  input: QuoteInput & { destinationAddress: string; externalId?: string },
): OnrampSessionRecord {
  const quote = quoteOnramp(input);
  const id = `onr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const record: OnrampSessionRecord = {
    id,
    status: "requires_payment",
    quote,
    destinationAddress: input.destinationAddress,
    clientSecret: `${id}_secret_${randomBytes(12).toString("hex")}`,
    externalId: input.externalId,
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, record);
  return record;
}

export function getOnrampSession(id: string): OnrampSessionRecord | undefined {
  return sessions.get(id);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
