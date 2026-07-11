import crypto from "crypto";
import { kvSetNx } from "@/lib/kv";
import {
  NETWORK,
  PAY_TO,
  USDC_ASSET,
  requiredConfirmations,
} from "@/lib/x402";
import { verifyAuthorizationSignature, canVerifySignature } from "@/lib/x402Signature";
import { defaultSettler, SettlementPendingError } from "@/lib/x402Settler";
import { recordSettlement } from "@/lib/x402SettlementStore";
import type { FacilitatorRequest } from "@/lib/x402Facilitator";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Machine Payments Protocol (MPP) adapter — the second 402 dialect.
//
// Stripe/Tempo's MPP (launched Mar 2026, proposed to the IETF as the "Payment"
// HTTP authentication scheme, paymentauth.org) is the same request → 402 →
// pay → retry loop as x402, but framed as HTTP auth rather than an X-PAYMENT
// header:
//   402 + `WWW-Authenticate: Payment id=… method=… intent=… request=…`
//   client retries with `Authorization: Payment <base64url credential>`
//   200 + `Payment-Receipt: <base64url receipt>`
//
// FurlPay already owns the hard parts (EIP-3009 signature recovery, the real
// on-chain settler with confirmation-depth gating + pending recovery, durable
// single-use claims). This module reuses ALL of that and only translates the
// wire format, so FurlPay is a facilitator that speaks BOTH x402 and MPP over
// one settlement engine. Our crypto method id is `usdc-eip3009`: the payload
// proof is exactly the EIP-3009 authorization + signature x402 uses.
//
// Spec anchors (draft-httpauth-payment-00): the challenge `id` is a stateless
// HMAC-SHA256 over 7 pipe-joined slots; `request` is base64url(JCS(json)); the
// credential echoes the challenge and carries a method-specific `payload`.
// ---------------------------------------------------------------------------

export const MPP_METHOD = "usdc-eip3009";
export const MPP_INTENT = "charge";
const CHALLENGE_TTL_SECONDS = 300; // 5 min, mirrors x402 quote TTL
const CLAIM_TTL_SECONDS = 86_400;
const MAX_HEADER_BYTES = 8 * 1024;

/** Live mode: verify signatures + require a real settler. Mirrors x402LiveMode
 *  in lib/x402.ts (same env contract) so both dialects arm together. */
function liveMode(): boolean {
  return process.env.INTEGRATION_MODE === "live" || process.env.X402_ENFORCE_SIGNATURE === "1";
}

function challengeSecret(): Buffer {
  // Shared with x402's quote binding — one trust boundary for both dialects.
  return Buffer.from(process.env.X402_QUOTE_SECRET || "x402_dev_quote_secret_change_me");
}

// ── base64url (no padding) ────────────────────────────────────────────────
function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** RFC 8785 JSON Canonicalization, sufficient subset for our flat, string/
 *  number-valued request objects: recursively sort object keys, compact
 *  separators. Deterministic so the client and server derive the same `id`. */
function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** Atomic USDC (6dp) for a USD price. */
function atomicUsdc(priceUsd: number): string {
  return BigInt(Math.round(priceUsd * 1e6)).toString();
}

export interface MppRequestData {
  amount: string; // USD minor units (cents), Stripe convention
  currency: "usd";
  recipient: string; // payTo
  asset: string; // token contract (EIP-3009 verifyingContract)
  network: string;
  maxAmountRequired: string; // atomic token units the authorization must equal
  decimals: number;
}

/** The 7-slot stateless binding from draft-httpauth-payment-00 §challenge. */
function challengeId(realm: string, requestB64: string, expires: string): string {
  const input = [realm, MPP_METHOD, MPP_INTENT, requestB64, expires, "", ""].join("|");
  return b64urlEncode(crypto.createHmac("sha256", challengeSecret()).update(input).digest());
}

export interface MppChallenge {
  header: string; // WWW-Authenticate value
  id: string;
  request: MppRequestData;
}

/** Build a `WWW-Authenticate: Payment` challenge for a priced resource. */
export function buildChallenge(opts: {
  realm: string;
  priceUsd: number;
  description?: string;
}): MppChallenge {
  const request: MppRequestData = {
    amount: String(Math.round(opts.priceUsd * 100)),
    currency: "usd",
    recipient: PAY_TO,
    asset: USDC_ASSET,
    network: NETWORK,
    maxAmountRequired: atomicUsdc(opts.priceUsd),
    decimals: 6,
  };
  const requestB64 = b64urlEncode(jcs(request));
  const expires = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const id = challengeId(opts.realm, requestB64, expires);

  const params = [
    `id="${id}"`,
    `realm="${opts.realm}"`,
    `method="${MPP_METHOD}"`,
    `intent="${MPP_INTENT}"`,
    `expires="${expires}"`,
    `request="${requestB64}"`,
  ];
  if (opts.description) params.push(`description="${opts.description.replace(/"/g, "")}"`);
  return { header: `Payment ${params.join(", ")}`, id, request };
}

interface MppCredential {
  challenge: {
    id: string;
    realm: string;
    method: string;
    intent: string;
    request: string;
    expires?: string;
  };
  source?: string;
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
}

export type MppResult =
  | { ok: true; reference: string; payer: string }
  | {
      ok: false;
      problem: string; // paymentauth.org problem slug
      detail: string;
      pending?: { reference: string; statusPath: string };
    };

/**
 * Verify an `Authorization: Payment` credential against the resource's price
 * and settle the EIP-3009 payload on-chain. Fails closed on every mismatch,
 * returns the tx hash as the receipt reference. Shares the settler + pending
 * recovery with the x402 path.
 */
export async function verifyMppPayment(opts: {
  authorization: string | null;
  realm: string;
  priceUsd: number;
}): Promise<MppResult> {
  const { authorization, realm, priceUsd } = opts;
  const fail = (problem: string, detail: string): MppResult => ({ ok: false, problem, detail });

  if (!authorization) return fail("payment-required", "Authorization: Payment credential required");
  const raw = authorization.replace(/^Payment\s+/i, "");
  if (raw.length > MAX_HEADER_BYTES) return fail("malformed-credential", "Credential too large");

  let cred: MppCredential;
  try {
    cred = JSON.parse(b64urlDecode(raw).toString("utf8"));
  } catch {
    return fail("malformed-credential", "Credential is not valid base64url JSON");
  }

  const ch = cred?.challenge;
  const auth = cred?.payload?.authorization;
  const sig = cred?.payload?.signature;
  if (!ch || !auth || typeof sig !== "string") return fail("malformed-credential", "Missing challenge or payload");
  if (ch.method !== MPP_METHOD) return fail("method-unsupported", `Unsupported method (expected ${MPP_METHOD})`);

  // Recompute the expected request + id server-side; never trust the client's
  // copy of the amount/recipient. This is x402's binding check in MPP framing.
  const expected = buildChallenge({ realm, priceUsd });
  const expectedRequestB64 = b64urlEncode(jcs(expected.request));
  if (ch.request !== expectedRequestB64) return fail("invalid-challenge", "Challenge request does not match this resource");
  if (!ch.expires) return fail("invalid-challenge", "Challenge missing expiry");
  const recomputedId = challengeId(realm, ch.request, ch.expires);
  const a = Buffer.from(recomputedId);
  const b = Buffer.from(ch.id || "");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail("invalid-challenge", "Challenge id binding mismatch");
  }
  if (Date.now() > Date.parse(ch.expires)) return fail("payment-expired", "Challenge expired");

  // Authorization must pay exactly this resource's amount, to our treasury.
  if ((auth.to || "").toLowerCase() !== PAY_TO.toLowerCase()) {
    return fail("verification-failed", "Payment not addressed to this recipient");
  }
  if (auth.value !== expected.request.maxAmountRequired) {
    return fail("payment-insufficient", `Wrong amount (expected ${expected.request.maxAmountRequired} atomic)`);
  }

  // Single-use claims (cross-instance, Redis SET NX): the challenge id AND the
  // EIP-3009 nonce, so neither a replayed credential nor a replayed nonce can
  // settle twice.
  if (!(await kvSetNx(`mpp:nonce:${auth.nonce}`, 1, CLAIM_TTL_SECONDS))) {
    return fail("verification-failed", "Authorization nonce already used (replay rejected)");
  }
  if (!(await kvSetNx(`mpp:challenge:${ch.id}`, 1, CLAIM_TTL_SECONDS))) {
    return fail("invalid-challenge", "Challenge already redeemed (replay rejected)");
  }

  // ── cryptographic authorization (live mode) ──
  if (liveMode()) {
    if (!canVerifySignature(NETWORK)) return fail("verification-failed", "signature scheme unavailable for network");
    const verdict = await verifyAuthorizationSignature(auth, sig, {
      network: NETWORK,
      asset: expected.request.asset,
      domainName: "USD Coin",
      domainVersion: "2",
    });
    if (!verdict.verified) return fail("verification-failed", `Invalid payment signature (${verdict.reason})`);
  }

  // ── settle ── (mock reference off live: deterministic hash, demo only)
  const required = requiredConfirmations(auth.value);
  if (!liveMode()) {
    return { ok: true, reference: "0x" + crypto.randomBytes(32).toString("hex"), payer: auth.from };
  }

  const settler = defaultSettler();
  if (!settler) return fail("verification-failed", "settlement unavailable — no on-chain settler configured");

  const facReq: FacilitatorRequest = {
    x402Version: 1,
    paymentPayload: {
      x402Version: 1,
      scheme: "exact",
      network: NETWORK,
      payload: { signature: sig, authorization: auth },
    },
    paymentRequirements: {
      scheme: "exact",
      network: NETWORK,
      maxAmountRequired: expected.request.maxAmountRequired,
      resource: realm,
      description: "",
      mimeType: "application/json",
      payTo: PAY_TO,
      maxTimeoutSeconds: CHALLENGE_TTL_SECONDS,
      asset: expected.request.asset,
      extra: { name: "USD Coin", version: "2", quoteId: ch.id, expiresAt: Math.floor(Date.parse(ch.expires) / 1000), binding: ch.id },
    },
  };

  try {
    const submission = await settler(facReq, auth.from, required);
    if (submission.confirmations < required) {
      return fail("verification-failed", "Settlement not yet final (insufficient confirmations)");
    }
    await recordSettlement({
      transaction: submission.transaction,
      network: NETWORK,
      payer: auth.from,
      payTo: PAY_TO,
      amountAtomic: expected.request.maxAmountRequired,
      resource: realm,
      settledAt: new Date().toISOString(),
      status: "confirmed",
    });
    return { ok: true, reference: submission.transaction, payer: auth.from };
  } catch (e) {
    if (e instanceof SettlementPendingError) {
      await recordSettlement({
        transaction: e.transaction,
        network: NETWORK,
        payer: auth.from,
        payTo: PAY_TO,
        amountAtomic: expected.request.maxAmountRequired,
        resource: realm,
        settledAt: new Date().toISOString(),
        status: "pending",
      });
      return {
        ok: false,
        problem: "verification-failed",
        detail: "Settlement submitted but not yet confirmed — poll the status path before retrying",
        pending: { reference: e.transaction, statusPath: `/api/x402/settlement/${e.transaction}` },
      };
    }
    log.error("mpp settlement failed", { error: (e as Error).message, realm });
    return fail("verification-failed", "Settlement failed on-chain");
  }
}

/** `Payment-Receipt` header value for a settled MPP payment. */
export function receiptHeader(reference: string): string {
  return b64urlEncode(
    JSON.stringify({
      status: "success",
      method: MPP_METHOD,
      timestamp: new Date().toISOString(),
      reference,
    })
  );
}

/** RFC 9457 problem+json body for a 402 barrier. */
export function problemBody(problem: string, detail: string): Record<string, unknown> {
  return {
    type: `https://paymentauth.org/problems/${problem}`,
    title: "Payment Required",
    status: 402,
    detail,
  };
}
