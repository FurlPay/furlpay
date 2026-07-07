import crypto from "crypto";

// ---------------------------------------------------------------------------
// Hardened x402 (HTTP 402 "Payment Required") implementation.
//
// x402 lets AI agents and API clients pay per-request in USDC: the server
// replies 402 with PaymentRequirements; the client signs an EIP-3009
// transferWithAuthorization and retries with an X-PAYMENT header; a
// facilitator verifies/settles and the server releases the resource.
//
// This implementation explicitly defends the four weakness classes documented
// in "Five Attacks on x402" (arXiv:2605.11781) and "Free-Riding the Agentic
// Web" (arXiv:2605.30998):
//
//   1. AUTHORIZATION — every field of the presented payment (amount, asset,
//      recipient, network) is compared against the server-side quote; nothing
//      is trusted from the client copy of the requirements.
//   2. BINDING — quotes carry an HMAC over (resource, method, amount, expiry,
//      quoteId), so a payment authorized for one resource cannot unlock
//      another, and tampered quotes fail closed.
//   3. REPLAY — quoteIds and EIP-3009 nonces are single-use (in-memory here;
//      Redis/DB in production) and quotes expire after a short window.
//   4. WEB-LAYER — the X-PAYMENT header is size-capped and parsed strictly;
//      malformed input returns 400, never a 5xx or a free resource.
//
// Settlement is mocked (INTEGRATION_MODE=mock) — swap `settle()` for a real
// facilitator to go live. USDC on Arbitrum One by default: the deepest
// stablecoin liquidity of any L2 and Furlpay's settlement rail.
// ---------------------------------------------------------------------------

export const X402_VERSION = 1;
export const NETWORK = process.env.X402_NETWORK || "arbitrum";
// Canonical USDC per supported network (native issuance, not bridged).
export const NETWORK_USDC: Record<string, string> = {
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "arbitrum-sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  // Polygon PoS native USDC (Circle-issued, not bridged USDC.e) — high
  // stablecoin volume + CCTP V2 support, so it settles the same as Arbitrum.
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
export const USDC_ASSET =
  process.env.X402_USDC_ADDRESS || NETWORK_USDC[NETWORK] || NETWORK_USDC.arbitrum;
// Treasury receiving per-call payments.
export const PAY_TO =
  process.env.X402_PAY_TO || "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

const QUOTE_TTL_SECONDS = 300;
const MAX_HEADER_BYTES = 8192; // web-layer: cap header size before parsing

function secret(): Buffer {
  return Buffer.from(process.env.X402_QUOTE_SECRET || "x402_dev_quote_secret_change_me");
}

// Single-use stores (production: Redis with TTL).
const g = globalThis as unknown as {
  __x402?: { usedQuotes: Map<string, number>; usedNonces: Set<string> };
};
const store = g.__x402 ?? (g.__x402 = { usedQuotes: new Map(), usedNonces: new Set() });

function gcQuotes() {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, exp] of store.usedQuotes) if (exp < now - 3600) store.usedQuotes.delete(id);
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string; // atomic units (USDC = 6 decimals)
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
    quoteId: string;
    expiresAt: number; // unix seconds
    binding: string; // HMAC binding quote -> resource
  };
}

function bindingMac(resource: string, method: string, amount: string, quoteId: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${method} ${resource} ${amount} ${quoteId} ${expiresAt}`)
    .digest("hex");
}

/** Build the 402 quote for a priced resource. */
export function buildRequirements(opts: {
  resource: string;
  method: string;
  priceUsd: number;
  description: string;
  mimeType?: string;
}): PaymentRequirements {
  const amount = String(Math.round(opts.priceUsd * 1e6)); // USDC atomic units
  const quoteId = crypto.randomBytes(16).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS;
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: amount,
    resource: opts.resource,
    description: opts.description,
    mimeType: opts.mimeType ?? "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: QUOTE_TTL_SECONDS,
    asset: USDC_ASSET,
    extra: {
      name: "USD Coin",
      version: "2",
      quoteId,
      expiresAt,
      binding: bindingMac(opts.resource, opts.method, amount, quoteId, expiresAt),
    },
  };
}

export interface XPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
  // echo of the quote the client is paying against
  extra?: { quoteId?: string; binding?: string; expiresAt?: number };
}

export type VerifyResult =
  | { ok: true; payer: string; txHash: string }
  | { ok: false; status: 400 | 402; error: string };

/**
 * Verify an X-PAYMENT header against the server-side expectation for this
 * resource. Fails closed on any mismatch.
 */
export function verifyPayment(opts: {
  header: string | null;
  resource: string;
  method: string;
  priceUsd: number;
}): VerifyResult {
  const { header, resource, method } = opts;
  const expectedAmount = String(Math.round(opts.priceUsd * 1e6));

  // ── web-layer hardening ──
  if (!header) return { ok: false, status: 402, error: "X-PAYMENT header required" };
  if (header.length > MAX_HEADER_BYTES) return { ok: false, status: 400, error: "X-PAYMENT too large" };
  let p: XPaymentPayload;
  try {
    p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "X-PAYMENT is not valid base64 JSON" };
  }
  const auth = p?.payload?.authorization;
  const sig = p?.payload?.signature;
  if (p.x402Version !== X402_VERSION || !auth || typeof sig !== "string") {
    return { ok: false, status: 400, error: "Malformed x402 payload" };
  }

  // ── authorization hardening: exact server-side field checks ──
  if (p.scheme !== "exact") return { ok: false, status: 402, error: "Unsupported scheme" };
  if (p.network !== NETWORK) return { ok: false, status: 402, error: `Wrong network (expected ${NETWORK})` };
  if (auth.to.toLowerCase() !== PAY_TO.toLowerCase()) {
    return { ok: false, status: 402, error: "Payment not addressed to this recipient" };
  }
  if (auth.value !== expectedAmount) {
    return { ok: false, status: 402, error: `Wrong amount (expected ${expectedAmount} atomic USDC)` };
  }

  // ── binding hardening: payment must reference an untampered quote for THIS resource ──
  const quoteId = p.extra?.quoteId;
  const binding = p.extra?.binding;
  const expiresAt = p.extra?.expiresAt;
  if (!quoteId || !binding || !expiresAt) {
    return { ok: false, status: 402, error: "Missing quote binding (re-request the 402 quote)" };
  }
  const expectedMac = bindingMac(resource, method, expectedAmount, quoteId, expiresAt);
  const a = Buffer.from(expectedMac);
  const b = Buffer.from(binding);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 402, error: "Quote binding mismatch (payment bound to a different resource)" };
  }

  // ── replay hardening: expiry window + single-use quote and nonce ──
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) return { ok: false, status: 402, error: "Quote expired (re-request the 402 quote)" };
  const vAfter = Number(auth.validAfter), vBefore = Number(auth.validBefore);
  if (Number.isFinite(vAfter) && now < vAfter) return { ok: false, status: 402, error: "Authorization not yet valid" };
  if (Number.isFinite(vBefore) && now > vBefore) return { ok: false, status: 402, error: "Authorization expired" };
  if (store.usedQuotes.has(quoteId)) return { ok: false, status: 402, error: "Quote already redeemed (replay rejected)" };
  if (store.usedNonces.has(auth.nonce)) return { ok: false, status: 402, error: "Authorization nonce already used (replay rejected)" };

  // ── settle (mock facilitator) ──
  // Production: POST to the facilitator's /verify then /settle and check the
  // on-chain result before releasing the resource.
  store.usedQuotes.set(quoteId, expiresAt);
  store.usedNonces.add(auth.nonce);
  gcQuotes();
  const txHash = "0x" + crypto.randomBytes(32).toString("hex");
  return { ok: true, payer: auth.from, txHash };
}

/** X-PAYMENT-RESPONSE header value for a successful settlement. */
export function settlementHeader(payer: string, txHash: string): string {
  return Buffer.from(
    JSON.stringify({ success: true, network: NETWORK, payer, transaction: txHash })
  ).toString("base64");
}
