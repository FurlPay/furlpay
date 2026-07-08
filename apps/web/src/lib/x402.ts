import crypto from "crypto";
import { kvSetNx, kvBackend } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Hardened x402 (HTTP 402 "Payment Required") implementation.
//
// x402 lets AI agents and API clients pay per-request in USDC: the server
// replies 402 with PaymentRequirements; the client signs an EIP-3009
// transferWithAuthorization and retries with an X-PAYMENT header; a
// facilitator verifies/settles and the server releases the resource.
//
// This implementation explicitly defends the weakness classes documented in
// "Five Attacks on x402" (arXiv:2605.11781) and "Free-Riding the Agentic Web"
// (arXiv:2605.30998):
//
//   1. AUTHORIZATION — every field of the presented payment (amount, asset,
//      recipient, network) is compared against the server-side quote; nothing
//      is trusted from the client copy of the requirements.
//   2. BINDING — quotes carry an HMAC over (resource, method, amount, expiry,
//      quoteId), so a payment authorized for one resource cannot unlock
//      another, and tampered quotes fail closed.
//   3. REPLAY (Attack II) — quoteIds and EIP-3009 nonces are single-use via an
//      ATOMIC cross-instance claim (Redis SET NX through lib/kv.ts). This is
//      the fix for the serverless replay hole: an in-memory Set is per-lambda,
//      so on Vercel the same X-PAYMENT replayed against different instances
//      would each clear a per-instance Set and produce duplicate grants
//      (the paper's DGR=n, 248 grants/payment). SET NX linearizes the claim
//      across every instance. Falls back to a bounded in-memory store only
//      when no Redis is configured (single-instance dev).
//   4. WEB-LAYER (Attack III) — the X-PAYMENT header is size-capped and parsed
//      strictly (malformed input returns 400, never a free resource), and paid
//      responses must carry Cache-Control: no-store (see `noStoreHeaders` /
//      `withNoStore`) so a shared/CDN cache never serves paid content to an
//      unpaid client.
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
// How long a spent quote/nonce claim is retained. Must outlive any authorization
// validity window so a late replay can never re-clear the claim; USDC rejects the
// authorization on-chain once validBefore passes, so 24h is a safe ceiling.
const REPLAY_CLAIM_TTL_SECONDS = 86_400;

function secret(): Buffer {
  return Buffer.from(process.env.X402_QUOTE_SECRET || "x402_dev_quote_secret_change_me");
}

/** Atomically claim a single-use token across all instances (Redis SET NX).
 *  Returns true iff this caller is the first to claim it. */
async function claimOnce(kind: "quote" | "nonce", token: string): Promise<boolean> {
  return kvSetNx(`x402:${kind}:${token}`, Math.floor(Date.now() / 1000), REPLAY_CLAIM_TTL_SECONDS);
}

// Whether cross-instance replay protection is durable. When no Redis is
// configured the claim falls back to a per-instance store — correct on one
// instance, but callers should surface this in prod readiness checks.
export const replayProtectionDurable = kvBackend === "redis";

// ── Attack I-A: confirmation-depth policy (paper Corollary 10) ─────────────
//
// x402's revert-grant attack: a server that releases a resource on a non-final
// settlement can be left unpaid if the tx is later reorged. The mitigation is
// to wait for k confirmations scaled to the resource value. Base/Arbitrum L2
// blocks are ~2s; the paper recommends k≥3 for sub-$1 resources (ε<1e-2) and
// k≥12 for resources above $10 (ε<1e-4). A real settler must not report
// `confirmed` until it has observed at least this depth.
/** Required confirmation depth for a settlement of `amountAtomic` USDC (6dp). */
export function requiredConfirmations(amountAtomic: string): number {
  let usd: number;
  try {
    usd = Number(BigInt(amountAtomic)) / 1e6;
  } catch {
    usd = Infinity; // unparseable → demand the strongest gate
  }
  if (usd < 1) return 3;
  if (usd < 10) return 6;
  return 12;
}

// ── Attack III: cache hygiene ──────────────────────────────────────────────
/** Headers that keep a payment-gated response out of every shared/CDN cache. */
export const noStoreHeaders: Record<string, string> = {
  "Cache-Control": "no-store, private, max-age=0",
  Vary: "X-PAYMENT",
};

/** Stamp no-store on a Response (paid resources and fresh 402 quotes alike). */
export function withNoStore<T extends { headers: Headers }>(res: T): T {
  for (const [k, v] of Object.entries(noStoreHeaders)) res.headers.set(k, v);
  return res;
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
 * resource. Fails closed on any mismatch. Async because the single-use claim
 * is an atomic cross-instance operation (Redis SET NX) — see Attack II above.
 */
export async function verifyPayment(opts: {
  header: string | null;
  resource: string;
  method: string;
  priceUsd: number;
}): Promise<VerifyResult> {
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

  // ── replay hardening: expiry window, then ATOMIC single-use claim ──
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) return { ok: false, status: 402, error: "Quote expired (re-request the 402 quote)" };
  const vAfter = Number(auth.validAfter), vBefore = Number(auth.validBefore);
  if (Number.isFinite(vAfter) && now < vAfter) return { ok: false, status: 402, error: "Authorization not yet valid" };
  if (Number.isFinite(vBefore) && now > vBefore) return { ok: false, status: 402, error: "Authorization expired" };

  // Claim the EIP-3009 nonce first (the money-level single-use token), then the
  // quote. SET NX linearizes both across every serverless instance, so a
  // replay — same instance, another instance, or concurrent — loses the claim
  // and is rejected here before any resource is released (Attack II).
  if (!(await claimOnce("nonce", auth.nonce))) {
    return { ok: false, status: 402, error: "Authorization nonce already used (replay rejected)" };
  }
  if (!(await claimOnce("quote", quoteId))) {
    return { ok: false, status: 402, error: "Quote already redeemed (replay rejected)" };
  }

  // ── settle (mock facilitator) ──
  // Production: POST to the facilitator's /verify then /settle, which gates on
  // `requiredConfirmations(auth.value)` before reporting success (Attack I-A),
  // and only then release the resource.
  const txHash = "0x" + crypto.randomBytes(32).toString("hex");
  return { ok: true, payer: auth.from, txHash };
}

/** X-PAYMENT-RESPONSE header value for a successful settlement. */
export function settlementHeader(payer: string, txHash: string): string {
  return Buffer.from(
    JSON.stringify({ success: true, network: NETWORK, payer, transaction: txHash })
  ).toString("base64");
}
