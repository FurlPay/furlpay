import crypto from "crypto";
import { signatureEnforced } from "@/lib/x402Enforcement";
import { kvSetNx, kvBackend } from "@/lib/kv";
import { verifyAuthorizationSignature } from "@/lib/x402Signature";
import { defaultSettler, SettlementPendingError } from "@/lib/x402Settler";
import { recordSettlement } from "@/lib/x402SettlementStore";
import { recordX402Revenue } from "@/lib/revenue/x402";
import type { FacilitatorRequest } from "@/lib/x402Facilitator";
import { log } from "@/lib/log";
import { quoteSecret } from "@/lib/x402QuoteSecret";

/** Live mode enforces both EIP-3009 signature recovery and real on-chain
 *  settlement; mock mode (default) keeps structural checks + a deterministic
 *  hash so the zero-credential demo runs. */
// Signature enforcement: see lib/x402Enforcement.ts. Production always enforces
// and cannot be configured out of it (SR2).
const x402LiveMode = signatureEnforced;

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
  // Circle Arc. This is the ERC-20 INTERFACE onto Arc's native USDC — a
  // precompile-shaped address, same on mainnet and testnet, verified on both
  // 2026-09-17 (decimals() == 6, symbol() == "USDC", version() == "2").
  //
  // READ THIS BEFORE TOUCHING AMOUNTS ON ARC. Arc's native gas balance is 18
  // decimals, but `transferWithAuthorization` is an ERC-20 function on the
  // contract below, so every x402 amount on Arc is SIX decimals exactly like
  // every other network here — `atomicAmount()` needs no special case. The
  // 18-decimal side only appears when reading a native balance or estimating
  // gas; lib/chains/arc.ts owns that conversion.
  arc: "0x3600000000000000000000000000000000000000",
  "arc-testnet": "0x3600000000000000000000000000000000000000",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
export const USDC_ASSET =
  process.env.X402_USDC_ADDRESS || NETWORK_USDC[NETWORK] || NETWORK_USDC.arbitrum;

// StraitsX XSGD — MAS-regulated SGD settlement for APAC agentic payments.
// Addresses verified on-chain 2026-07-09 (symbol XSGD, 6 decimals).
export const NETWORK_XSGD: Record<string, string> = {
  arbitrum: "0xE333e7754a2DC1E020a162Ecab019254b9DaB653",
  ethereum: "0x70e8dE73cE538DA2bEEd35d14187F6959a8ecA96",
  polygon: "0xDC3326e71D45186F113a2F448984CA0e8D201995",
  solana: "71S9cppWipeUEQDFngYwxjoxB6Sz1MUqX72byLsVYJqy",
};
export const XSGD_ASSET = process.env.X402_XSGD_ADDRESS || NETWORK_XSGD[NETWORK] || "";
// Mock mid-market USD/SGD; a live deployment prices from an FX oracle.
export const XSGD_USD_RATE = Number(process.env.X402_XSGD_USD_RATE || 0.78);

export type X402Asset = "USDC" | "XSGD";

/** Price in atomic units (both assets are 6-decimal) for the given asset. */
function atomicAmount(priceUsd: number, asset: X402Asset): string {
  const units = asset === "XSGD" ? priceUsd / XSGD_USD_RATE : priceUsd;
  return String(Math.round(units * 1e6));
}
// Treasury receiving per-call payments.
export const PAY_TO =
  process.env.X402_PAY_TO || "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

const QUOTE_TTL_SECONDS = 300;
const MAX_HEADER_BYTES = 8192; // web-layer: cap header size before parsing
// How long a spent quote/nonce claim is retained. Must outlive any authorization
// validity window so a late replay can never re-clear the claim; USDC rejects the
// authorization on-chain once validBefore passes, so 24h is a safe ceiling.
const REPLAY_CLAIM_TTL_SECONDS = 86_400;

// No default: production requires X402_QUOTE_SECRET (see lib/x402QuoteSecret.ts).
function secret(): Buffer {
  return quoteSecret();
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
/**
 * Required confirmation depth for a settlement of `amountAtomic` USDC (6dp).
 *
 * F-18. This previously read the amount with a bare `BigInt(amountAtomic)` and
 * returned 3 for anything under $1 — which handed the WEAKEST gate to every
 * value `BigInt` silently coerces rather than rejects:
 *
 *     ""  and "   "  ->  0n   (not a throw)      ->  3 confirmations
 *     "0x10"         ->  16n  (hex accepted)     ->  3 confirmations
 *     "+5"           ->  5n                      ->  3 confirmations
 *     "-99999999999" ->  negative, still `< 1`   ->  3 confirmations
 *
 * Only `"abc"`-shaped input actually threw, so the `catch` that was supposed to
 * be the fail-closed path almost never ran. The surrounding code establishes a
 * fail-closed convention and this function quietly broke it.
 *
 * Now the amount must be decimal digits — the same `/^[0-9]+$/` rule
 * `parseAtomic` applies everywhere else in the repo (F-9) — and anything else,
 * including zero, demands 12. A zero-value settlement is not a cheap settlement;
 * it is a nonsensical one, and nonsense earns maximum caution.
 *
 * THE FLOAT IS DELIBERATE AND SAFE. Beyond 2^53 `Number(BigInt(x))` loses
 * precision, but only upward — toward a larger figure, which selects a STRONGER
 * gate. The error direction cannot weaken the control, so the comparison stays
 * readable rather than being rewritten in BigInt for no behavioural gain.
 */
export function requiredConfirmations(amountAtomic: string): number {
  if (typeof amountAtomic !== "string" || !/^[0-9]+$/.test(amountAtomic.trim())) return 12;
  const atomic = BigInt(amountAtomic.trim());
  if (atomic <= 0n) return 12;
  const usd = Number(atomic) / 1e6;
  if (!Number.isFinite(usd)) return 12;
  if (usd < 1) return 3;
  if (usd < 10) return 6;
  return 12;
}

// ── Attack III: cache hygiene ──────────────────────────────────────────────
/** Headers that keep a payment-gated response out of every shared/CDN cache. */
export const noStoreHeaders: Record<string, string> = {
  "Cache-Control": "no-store, private, max-age=0",
  // Both dialects' request headers — a Vary that names only X-PAYMENT would let
  // a shared cache serve a v2-paid response to the next unpaid v2 caller.
  Vary: "X-PAYMENT, PAYMENT-SIGNATURE",
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
    /**
     * HTTP method the binding was computed over.
     *
     * Present so the commitment is SELF-DESCRIBING. `bindingMac` mixes the
     * method in, so a verifier that does not know it cannot recompute the MAC —
     * which is why the facilitator could not check the binding at all before
     * this field existed. Optional for one quote TTL so quotes minted by an
     * older deployment still verify; see verifyResourceBinding for the narrowed
     * fallback that handles them.
     */
    method?: string;
  };
}

/**
 * HMAC binding a quote to the exact resource it was issued for.
 *
 * EXPORTED so the FACILITATOR can verify the same commitment this middleware
 * issues. It was private, and the consequence was SR1: the facilitator had no
 * way to tell that an authorization presented to it was bound to a different
 * resource than the one being paid for, because the only component that could
 * check was the resource server itself.
 *
 * Keyed with our own secret, so a caller cannot mint a binding for a resource
 * we did not price.
 */
export function bindingMac(resource: string, method: string, amount: string, quoteId: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${method} ${resource} ${amount} ${quoteId} ${expiresAt}`)
    .digest("hex");
}

/** Build the 402 quote for a priced resource, in the given settlement asset. */
export function buildRequirements(opts: {
  resource: string;
  method: string;
  priceUsd: number;
  description: string;
  mimeType?: string;
  asset?: X402Asset;
}): PaymentRequirements {
  const asset: X402Asset = opts.asset ?? "USDC";
  const amount = atomicAmount(opts.priceUsd, asset);
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
    asset: asset === "XSGD" ? XSGD_ASSET : USDC_ASSET,
    extra: {
      name: asset === "XSGD" ? "XSGD" : "USD Coin",
      version: "2",
      quoteId,
      expiresAt,
      method: opts.method.toUpperCase(),
      binding: bindingMac(opts.resource, opts.method, amount, quoteId, expiresAt),
    },
  };
}

/** Every requirement a 402 should advertise: USDC always, plus XSGD when the
 *  active network has a deployment — the agent picks its settlement asset. */
export function acceptedRequirements(opts: {
  resource: string;
  method: string;
  priceUsd: number;
  description: string;
  mimeType?: string;
}): PaymentRequirements[] {
  const accepts = [buildRequirements(opts)];
  if (XSGD_ASSET) accepts.push(buildRequirements({ ...opts, asset: "XSGD" }));
  return accepts;
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

// ---------------------------------------------------------------------------
// x402 v2 (Dec 2025).
//
// Not a header rename — the shapes changed. `maxAmountRequired` became
// `amount`, resource metadata was hoisted out of each requirement into a
// top-level ResourceInfo, and the client now echoes the FULL `accepted`
// requirements instead of a bare `extra`. Shapes taken from the reference SDK
// (@x402/core), not from prose.
//
// We accept both dialects and normalize v2 onto the v1 shape immediately, so
// every security check below is written exactly once and cannot drift between
// versions. `extra` (quoteId / binding / expiresAt) is carried identically by
// both, which is why one binding MAC serves both.
// ---------------------------------------------------------------------------

export const X402_VERSION_V2 = 2;
export const HEADER_V2_PAYMENT = "payment-signature";
export const HEADER_V2_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_V2_RECEIPT = "PAYMENT-RESPONSE";

/** v2 hoists resource metadata here. `description` is also the field a
 *  facilitator crawls for discovery. */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirementsV2 {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string; // v1's maxAmountRequired
  payTo: string;
  maxTimeoutSeconds: number;
  extra: PaymentRequirements["extra"];
}

export interface PaymentRequiredV2 {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirementsV2[];
}

export interface XPaymentPayloadV2 {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirementsV2;
  payload: XPaymentPayload["payload"];
}

function toV2(r: PaymentRequirements): PaymentRequirementsV2 {
  return {
    scheme: r.scheme,
    network: r.network,
    asset: r.asset,
    amount: r.maxAmountRequired,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    extra: r.extra,
  };
}

/**
 * Mint ONE quote and render it in both dialects.
 *
 * A 402 can advertise both at once — v2 in the PAYMENT-REQUIRED header, v1 in
 * the body — which is exactly what v2 moving payment data out of the body is
 * for. Both renderings share a quoteId, so the quote stays single-use across
 * dialects: an agent cannot spend it as v1 and then re-spend it as v2.
 */
export function challenge(opts: {
  resource: string;
  method: string;
  priceUsd: number;
  description: string;
  mimeType?: string;
  error?: string;
}): { v1: PaymentRequirements[]; v2: PaymentRequiredV2 } {
  const accepts = acceptedRequirements(opts);
  return {
    v1: accepts,
    v2: {
      x402Version: 2,
      ...(opts.error ? { error: opts.error } : {}),
      resource: {
        url: opts.resource,
        description: opts.description,
        mimeType: opts.mimeType ?? "application/json",
      },
      accepts: accepts.map(toV2),
    },
  };
}

/** Base64 for the PAYMENT-REQUIRED header. */
export function paymentRequiredHeader(v2: PaymentRequiredV2): string {
  return Buffer.from(JSON.stringify(v2), "utf8").toString("base64");
}

/** Which dialect did the caller speak? `null` when no payment was presented. */
export function readPaymentHeader(headers: Headers): { version: 1 | 2; raw: string } | null {
  const v2 = headers.get(HEADER_V2_PAYMENT);
  if (v2) return { version: 2, raw: v2 };
  const v1 = headers.get("x-payment");
  if (v1) return { version: 1, raw: v1 };
  return null;
}

export type VerifyResult =
  | { ok: true; payer: string; txHash: string; asset: X402Asset; version: 1 | 2; amountAtomic: string }
  | {
      ok: false;
      status: 400 | 402;
      error: string;
      /** Set when the settlement was SUBMITTED on-chain but its confirmation
       *  was not observed before timing out — the payer may still be debited.
       *  Clients resolve via GET /api/x402/settlement/[transaction]. */
      pending?: { transaction: string; statusPath: string };
    };

/**
 * Verify a presented payment (x402 v1 or v2) against the server-side expectation
 * for this resource. Fails closed on any mismatch. Async because the single-use
 * claim is an atomic cross-instance operation (Redis SET NX) — see Attack II.
 */
export async function verifyPayment(opts: {
  headers: Headers;
  resource: string;
  method: string;
  priceUsd: number;
}): Promise<VerifyResult> {
  const { headers, resource, method } = opts;
  // Every advertised requirement is a distinct (asset, amount) pair; the
  // authorized amount identifies which one the agent chose to pay.
  const expectedByAsset: Record<X402Asset, string> = {
    USDC: atomicAmount(opts.priceUsd, "USDC"),
    XSGD: atomicAmount(opts.priceUsd, "XSGD"),
  };

  // ── web-layer hardening ──
  const presented = readPaymentHeader(headers);
  if (!presented) return { ok: false, status: 402, error: "X-PAYMENT header required" };
  const { version, raw } = presented;
  if (raw.length > MAX_HEADER_BYTES) return { ok: false, status: 400, error: "Payment header too large" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "Payment header is not valid base64 JSON" };
  }

  // ── normalize v2 onto the v1 shape; every check below runs once ──
  let p: XPaymentPayload;
  if (version === 2) {
    const v2 = decoded as XPaymentPayloadV2;
    if (v2?.x402Version !== X402_VERSION_V2 || !v2.accepted || !v2.payload) {
      return { ok: false, status: 400, error: "Malformed x402 v2 payload" };
    }
    p = {
      x402Version: X402_VERSION,
      scheme: v2.accepted.scheme,
      network: v2.accepted.network,
      payload: v2.payload,
      extra: v2.accepted.extra,
    };
  } else {
    p = decoded as XPaymentPayload;
    if (p?.x402Version !== X402_VERSION) {
      return { ok: false, status: 400, error: "Malformed x402 payload" };
    }
  }

  const auth = p?.payload?.authorization;
  const sig = p?.payload?.signature;
  if (!auth || typeof sig !== "string") {
    return { ok: false, status: 400, error: "Malformed x402 payload" };
  }

  // ── authorization hardening: exact server-side field checks ──
  if (p.scheme !== "exact") return { ok: false, status: 402, error: "Unsupported scheme" };
  if (p.network !== NETWORK) return { ok: false, status: 402, error: `Wrong network (expected ${NETWORK})` };
  if (auth.to.toLowerCase() !== PAY_TO.toLowerCase()) {
    return { ok: false, status: 402, error: "Payment not addressed to this recipient" };
  }
  const asset: X402Asset | undefined =
    auth.value === expectedByAsset.USDC
      ? "USDC"
      : XSGD_ASSET && auth.value === expectedByAsset.XSGD
        ? "XSGD"
        : undefined;
  if (!asset) {
    return {
      ok: false,
      status: 402,
      error: `Wrong amount (expected ${expectedByAsset.USDC} atomic USDC${XSGD_ASSET ? ` or ${expectedByAsset.XSGD} atomic XSGD` : ""})`,
    };
  }
  const expectedAmount = expectedByAsset[asset];

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

  const assetAddress = asset === "XSGD" ? XSGD_ASSET : USDC_ASSET;
  const domainName = asset === "XSGD" ? "XSGD" : "USD Coin";
  const expectedTransfer = {
    token: assetAddress,
    from: auth.from,
    to: auth.to,
    valueAtomic: expectedAmount,
    nonce: auth.nonce,
  };

  // ── cryptographic authorization (live mode) ──
  // Recover the EIP-3009 signer and require it to equal `from`. Without this
  // the checks above pass for a payment "from" an address the caller doesn't
  // control. Mock mode keeps structural-only so the demo runs keyless.
  if (x402LiveMode()) {
    const verdict = await verifyAuthorizationSignature(auth, sig, {
      network: NETWORK,
      asset: assetAddress,
      domainName,
      domainVersion: "2",
    });
    if (!verdict.verified) {
      return { ok: false, status: 402, error: `Invalid payment signature (${verdict.reason})` };
    }
  }

  // ── settle ──
  // Live mode submits the signed authorization on-chain via the real settler
  // and waits for the confirmation depth this amount requires (Attack I-A)
  // before releasing the resource. Mock mode returns a deterministic hash.
  const required = requiredConfirmations(auth.value);
  if (x402LiveMode()) {
    const settler = defaultSettler();
    if (!settler) {
      return { ok: false, status: 402, error: "Settlement unavailable — no on-chain settler configured" };
    }
    const facReq: FacilitatorRequest = {
      x402Version: X402_VERSION,
      paymentPayload: p,
      paymentRequirements: {
        scheme: "exact",
        network: NETWORK,
        maxAmountRequired: expectedAmount,
        resource,
        description: "",
        mimeType: "application/json",
        payTo: PAY_TO,
        maxTimeoutSeconds: QUOTE_TTL_SECONDS,
        asset: assetAddress,
        extra: { name: domainName, version: "2", quoteId, expiresAt, binding },
      },
    };
    try {
      const submission = await settler(facReq, auth.from, required);
      if (submission.confirmations < required) {
        return { ok: false, status: 402, error: "Settlement not yet final (insufficient confirmations)" };
      }
      await recordSettlement({
        transaction: submission.transaction,
        network: NETWORK,
        payer: auth.from,
        payTo: PAY_TO,
        amountAtomic: expectedAmount,
        expectedTransfer,
        resource,
        settledAt: new Date().toISOString(),
        status: "confirmed",
      });

      // API revenue, but only if this resource is ours — see lib/revenue/x402.
      await recordX402Revenue({
        transaction: submission.transaction,
        network: NETWORK,
        payTo: PAY_TO,
        treasury: PAY_TO,
        amountAtomic: expectedAmount,
        resource,
        payer: auth.from,
      });
      return {
        ok: true,
        payer: auth.from,
        txHash: submission.transaction,
        asset,
        version,
        amountAtomic: expectedAmount,
      };
    } catch (e) {
      // Submitted-but-unconfirmed: the tx is on-chain and may still settle
      // (payer possibly debited, nonce burned). Log it as pending and hand the
      // client the tx + status route so it can resolve instead of assuming
      // the payment was lost.
      if (e instanceof SettlementPendingError) {
        await recordSettlement({
          transaction: e.transaction,
          network: NETWORK,
          payer: auth.from,
          payTo: PAY_TO,
          amountAtomic: expectedAmount,
          expectedTransfer,
          resource,
          settledAt: new Date().toISOString(),
          status: "pending",
        });
        log.warn("x402 settlement pending (submitted, confirmation timed out)", {
          tx: e.transaction,
          resource,
        });
        return {
          ok: false,
          status: 402,
          error: "Settlement submitted but not yet confirmed — poll the status path before retrying with a new authorization",
          pending: { transaction: e.transaction, statusPath: `/api/x402/settlement/${e.transaction}` },
        };
      }
      log.error("x402 live settlement failed", { error: (e as Error).message, resource });
      return { ok: false, status: 402, error: "Settlement failed on-chain" };
    }
  }

  // ── mock settle (demo, zero-credential) ──
  const txHash = "0x" + crypto.randomBytes(32).toString("hex");
  return { ok: true, payer: auth.from, txHash, asset, version, amountAtomic: expectedAmount };
}

/** X-PAYMENT-RESPONSE header value for a successful settlement (v1). */
export function settlementHeader(payer: string, txHash: string, asset: X402Asset = "USDC"): string {
  return Buffer.from(
    JSON.stringify({ success: true, network: NETWORK, payer, transaction: txHash, asset })
  ).toString("base64");
}

/** PAYMENT-RESPONSE header value (v2) — the reference SDK's SettleResponse shape. */
export function settlementHeaderV2(payer: string, txHash: string, amountAtomic: string): string {
  return Buffer.from(
    JSON.stringify({ success: true, transaction: txHash, network: NETWORK, payer, amount: amountAtomic })
  ).toString("base64");
}
