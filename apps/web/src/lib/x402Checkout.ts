import { checkUrl, pinnedFetch } from "@/lib/property/safeFetch";
import { NETWORK_USDC } from "@/lib/x402";
import { EVM_CHAIN_IDS, verifyAuthorizationSignature, type AuthorizationFields } from "@/lib/x402Signature";
import { kvSetNx } from "@/lib/kv";
import { maxTransferUsd } from "@/lib/moneyLimits";

// ---------------------------------------------------------------------------
// x402 checkout for the browser extension (audit 7 Oct 2026, P1-5).
//
// The extension detects a page answering HTTP 402 and opens
// /pay/x402?resource=<url>&origin=<page origin>. NOTHING about the payment
// comes from that URL: amount, recipient, asset and network are read from the
// merchant's own 402, fetched here, server-side, at preview AND again at pay
// time. The user's wallet signs an EIP-3009 transferWithAuthorization for
// exactly those terms; this module re-fetches the terms, checks the signed
// authorization field by field, verifies the signature (EIP-712 / ERC-1271),
// claims the nonce once per user, enforces the per-transfer cap, and only then
// presents the payment to the resource. The merchant's facilitator settles; no
// FurlPay funds move and FurlPay never holds the user's key.
//
// The resource URL is attacker-influenced, so every fetch goes through the
// SSRF guards of lib/property/safeFetch: https only, DNS resolved once and
// pinned, private/link-local/metadata ranges refused, no redirects followed
// (a payment must go to the URL the user saw), bounded time and size.
// ---------------------------------------------------------------------------

export const MAX_402_BYTES = 64_000;
const TIMEOUT_MS = 10_000;
const PREVIEW_BODY_BYTES = 4_000;

export interface CheckoutTerms {
  resource: string;
  x402Version: 1 | 2;
  scheme: "exact";
  network: string;
  chainId: number;
  asset: string;
  payTo: string;
  amountAtomic: string;
  /** Exact decimal (6 dp). */
  amountUsdc: string;
  maxTimeoutSeconds: number;
  description: string | null;
  domainName: string;
  domainVersion: string;
  /** The accepted requirement exactly as the merchant sent it (echoed back in v2). */
  requirement: Record<string, unknown>;
}

export type CheckoutError =
  | "bad_resource"
  | "unreachable"
  | "not_payment_required"
  | "unsupported_terms"
  | "malformed_terms"
  | "terms_mismatch"
  | "bad_signature"
  | "expired"
  | "over_limit"
  | "replay"
  | "store_unavailable";

export type Result<T> = { ok: true; value: T } | { ok: false; code: CheckoutError; message: string };

type Transport = typeof pinnedFetch;

const fail = <T>(code: CheckoutError, message: string): Result<T> => ({ ok: false, code, message });
const usdc = (atomic: string) => {
  const s = atomic.padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
};
const NAME_BY_CHAIN = Object.fromEntries(Object.entries(EVM_CHAIN_IDS).map(([n, id]) => [id, n]));

/** Network name FurlPay uses ("base"), from a v1 name or a v2 CAIP-2 id ("eip155:8453"). */
function networkName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const caip = /^eip155:(\d+)$/.exec(raw);
  if (caip) return NAME_BY_CHAIN[Number(caip[1])] ?? null;
  return raw in EVM_CHAIN_IDS ? raw : null;
}

/** Validate the resource URL shape before anything is fetched. */
export function checkResource(raw: string): Result<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("bad_resource", "Not a URL.");
  }
  if (url.protocol !== "https:") return fail("bad_resource", "Only https resources can be paid.");
  if (url.username || url.password) return fail("bad_resource", "URLs with credentials are refused.");
  if (raw.length > 2048) return fail("bad_resource", "URL too long.");
  url.hash = "";
  return { ok: true, value: url };
}

async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** One guarded request to the resource: validated, pinned, no redirects. */
async function guardedRequest(url: URL, headers: Record<string, string>, maxBytes: number, transport: Transport) {
  const check = await checkUrl(url.toString());
  if (!check.ok) throw Object.assign(new Error(check.detail ?? "refused"), { code: "bad_resource" as const });
  const res = await transport(url, check.address!, {
    timeoutMs: TIMEOUT_MS,
    headers: { "User-Agent": "FurlPayX402Checkout/1.0 (+https://furlpay.com/pay/x402)", Accept: "application/json, */*;q=0.5", ...headers },
  });
  if (res.status >= 300 && res.status < 400) throw Object.assign(new Error("The resource redirected; a payment must go to the URL shown."), { code: "unsupported_terms" as const });
  const body = await readBounded(res, maxBytes);
  return { status: res.status, headers: res.headers, body };
}

function decodeB64Json(v: string): unknown {
  return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
}

/** Parse a 402 (v1 JSON body or v2 PAYMENT-REQUIRED header) into the one set of terms FurlPay can pay. */
export function parseTerms(resource: string, status: number, headers: Headers, body: string): Result<CheckoutTerms> {
  if (status !== 402) return fail("not_payment_required", `The resource answered HTTP ${status}, not 402.`);
  type Doc = { x402Version?: unknown; accepts?: unknown; resource?: unknown };
  let doc: Doc | null = null;
  let version: 1 | 2 = 1;
  const v2 = headers.get("payment-required");
  try {
    if (v2) {
      doc = decodeB64Json(v2) as Doc;
      version = 2;
    } else {
      doc = JSON.parse(body) as Doc;
      version = doc?.x402Version === 2 ? 2 : 1;
    }
  } catch {
    return fail("malformed_terms", "The 402 does not carry readable x402 payment requirements.");
  }
  const accepts = doc && Array.isArray(doc.accepts) ? (doc.accepts as Record<string, unknown>[]) : [];
  if (!accepts.length) return fail("malformed_terms", "The 402 lists no payment options.");
  for (const a of accepts) {
    const network = networkName(a.network);
    if (a.scheme !== "exact" || !network) continue;
    const usdcAddr = NETWORK_USDC[network];
    const asset = typeof a.asset === "string" ? a.asset : "";
    if (!usdcAddr || asset.toLowerCase() !== usdcAddr.toLowerCase()) continue;
    const amount = String(version === 2 ? a.amount ?? a.maxAmountRequired : a.maxAmountRequired ?? a.amount);
    const payTo = typeof a.payTo === "string" ? a.payTo : "";
    const timeout = Number(a.maxTimeoutSeconds ?? 60);
    if (!/^\d{1,30}$/.test(amount) || BigInt(amount) <= 0n) return fail("malformed_terms", "The 402 amount is not a positive integer.");
    if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) return fail("malformed_terms", "The 402 recipient is not an address.");
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) return fail("malformed_terms", "The 402 timeout is out of range.");
    const extra = (a.extra ?? {}) as { name?: unknown; version?: unknown };
    return {
      ok: true,
      value: {
        resource,
        x402Version: version,
        scheme: "exact",
        network,
        chainId: EVM_CHAIN_IDS[network],
        asset: usdcAddr,
        payTo: payTo.toLowerCase(),
        amountAtomic: amount,
        amountUsdc: usdc(amount),
        maxTimeoutSeconds: Math.floor(timeout),
        description: typeof a.description === "string" ? a.description.slice(0, 200) : null,
        domainName: typeof extra.name === "string" ? extra.name : "USD Coin",
        domainVersion: typeof extra.version === "string" ? extra.version : "2",
        requirement: a,
      },
    };
  }
  return fail("unsupported_terms", "FurlPay can pay native USDC (scheme exact) on Ethereum, Base, Arbitrum or Polygon; this resource asks for something else.");
}

/** Fetch and parse the resource's current terms. */
export async function fetchTerms(rawResource: string, transport: Transport = pinnedFetch): Promise<Result<CheckoutTerms>> {
  const u = checkResource(rawResource);
  if (!u.ok) return u;
  try {
    const r = await guardedRequest(u.value, {}, MAX_402_BYTES, transport);
    return parseTerms(u.value.toString(), r.status, r.headers, r.body);
  } catch (e) {
    const code = (e as { code?: CheckoutError }).code;
    return fail(code ?? "unreachable", code ? (e as Error).message : "The resource could not be reached.");
  }
}

export interface SignedPayment {
  authorization: AuthorizationFields;
  signature: string;
}

export interface PaidResult {
  terms: CheckoutTerms;
  status: number;
  receipt: unknown;
  contentType: string | null;
  bodyPreview: string;
}

/** Check a signed authorization against terms. Pure apart from the clock. */
export function checkAuthorization(terms: CheckoutTerms, a: AuthorizationFields, nowS = Math.floor(Date.now() / 1000)): Result<true> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from) || !/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return fail("malformed_terms", "Malformed authorization.");
  if (a.to.toLowerCase() !== terms.payTo) return fail("terms_mismatch", "The signed recipient is not the resource's recipient.");
  if (a.value !== terms.amountAtomic) return fail("terms_mismatch", "The signed amount is not the resource's price.");
  const after = Number(a.validAfter);
  const before = Number(a.validBefore);
  if (!Number.isFinite(after) || !Number.isFinite(before)) return fail("malformed_terms", "Malformed validity window.");
  if (after > nowS || before <= nowS) return fail("expired", "The authorization is not valid now.");
  if (before > nowS + terms.maxTimeoutSeconds + 60) return fail("terms_mismatch", "The authorization outlives the resource's timeout.");
  const usd = Number(terms.amountUsdc);
  if (usd > maxTransferUsd()) return fail("over_limit", `Above the ${maxTransferUsd()} USD per-transfer limit.`);
  return { ok: true, value: true };
}

/**
 * Pay: re-fetch the terms, check and verify the authorization, claim its nonce
 * for this user, then present the payment to the resource (one request, no
 * redirects). Never trusts any term the client sent.
 */
export async function payResource(userId: string, rawResource: string, signed: SignedPayment, transport: Transport = pinnedFetch): Promise<Result<PaidResult>> {
  const t = await fetchTerms(rawResource, transport);
  if (!t.ok) return t;
  const terms = t.value;
  const check = checkAuthorization(terms, signed.authorization);
  if (!check.ok) return check;
  const verdict = await verifyAuthorizationSignature(signed.authorization, signed.signature, {
    network: terms.network,
    asset: terms.asset,
    domainName: terms.domainName,
    domainVersion: terms.domainVersion,
  });
  if (!verdict.verified) return fail("bad_signature", `Signature rejected: ${verdict.reason}`);
  // One use per (user, nonce). Fail closed: a store that cannot record the
  // claim cannot stop a double submission.
  let fresh: boolean;
  try {
    fresh = await kvSetNx(`x402:checkout:${userId}:${signed.authorization.nonce.toLowerCase()}`, terms.resource, 86_400);
  } catch {
    return fail("store_unavailable", "Payments are temporarily unavailable.");
  }
  if (!fresh) return fail("replay", "This authorization was already submitted.");
  const payload = { scheme: "exact", network: terms.network, payload: { signature: signed.signature, authorization: signed.authorization } };
  const header: Record<string, string> =
    terms.x402Version === 2
      ? { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify({ x402Version: 2, accepted: terms.requirement, payload: payload.payload })).toString("base64") }
      : { "X-PAYMENT": Buffer.from(JSON.stringify({ x402Version: 1, ...payload })).toString("base64") };
  try {
    const u = checkResource(terms.resource);
    if (!u.ok) return u;
    const r = await guardedRequest(u.value, header, 2_000_000, transport);
    const rawReceipt = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
    let receipt: unknown = null;
    if (rawReceipt) {
      try {
        receipt = decodeB64Json(rawReceipt);
      } catch {
        receipt = rawReceipt.slice(0, 500);
      }
    }
    return { ok: true, value: { terms, status: r.status, receipt, contentType: r.headers.get("content-type"), bodyPreview: r.body.slice(0, PREVIEW_BODY_BYTES) } };
  } catch (e) {
    const code = (e as { code?: CheckoutError }).code;
    return fail(code ?? "unreachable", code ? (e as Error).message : "The resource could not be reached to deliver the payment.");
  }
}
