import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { fetchTerms, payResource, type CheckoutError } from "@/lib/x402Checkout";

export const dynamic = "force-dynamic";

// /api/x402/checkout — the browser extension's x402 checkout (lib/x402Checkout.ts).
//
//   GET  ?resource=<https url>  the resource's CURRENT payment terms, read from
//                               its own 402 server-side (SSRF-guarded).
//   POST { resource, authorization, signature }
//                               re-fetch the terms, verify the user's signed
//                               EIP-3009 authorization against them, claim its
//                               nonce once, deliver the payment to the resource.
//
// Signed-in users only. Amount and recipient are never taken from the client.

const STATUS: Record<CheckoutError, number> = {
  bad_resource: 400,
  unreachable: 502,
  not_payment_required: 409,
  unsupported_terms: 422,
  malformed_terms: 422,
  terms_mismatch: 409,
  bad_signature: 400,
  expired: 409,
  over_limit: 422,
  replay: 409,
  store_unavailable: 503,
};

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "x402.checkout.preview", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const resource = req.nextUrl.searchParams.get("resource") ?? "";
  const r = await fetchTerms(resource);
  if (!r.ok) return NextResponse.json({ ok: false, error: { code: r.code, message: r.message } }, { status: STATUS[r.code] });
  const { requirement: _requirement, ...terms } = r.value;
  return NextResponse.json({ ok: true, data: terms }, { headers: { "cache-control": "no-store" } });
}

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Uint = z.string().regex(/^\d{1,30}$/);
const Body = z
  .object({
    resource: z.string().url().max(2048),
    authorization: z.object({ from: Addr, to: Addr, value: Uint, validAfter: Uint, validBefore: Uint, nonce: Hex32 }).strict(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/).max(4096),
  })
  .strict();

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "x402.checkout.pay", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;
  const r = await payResource(auth.account.user.id, body.resource, { authorization: body.authorization, signature: body.signature });
  if (!r.ok) {
    audit("x402.checkout.refused", auth.account.user.id, { code: r.code, resourceHost: safeHost(body.resource) });
    return NextResponse.json({ ok: false, error: { code: r.code, message: r.message } }, { status: STATUS[r.code] });
  }
  audit("x402.checkout.paid", auth.account.user.id, { resourceHost: safeHost(body.resource), network: r.value.terms.network, amountAtomic: r.value.terms.amountAtomic, status: r.value.status });
  const { requirement: _requirement, ...terms } = r.value.terms;
  return NextResponse.json({ ok: true, data: { ...r.value, terms } }, { headers: { "cache-control": "no-store" } });
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
