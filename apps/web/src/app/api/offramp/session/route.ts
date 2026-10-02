import { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "@/lib/clientIp";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { OfframpSessionSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { coinbaseOfframpUrl, coinbaseRampBackend, isCoinbaseRampChain } from "@/lib/services/coinbaseRamp";
import { rampGuard, rampCommit, type RampAuth } from "@/lib/ramp/rampGuard";
import { recordRampAudit } from "@/lib/ramp/rampAudit";
import { attachCheckout, createRampOrder, updateRampOrderStatus } from "@/lib/ramp/rampOrder";
import type { Chain } from "@/lib/security/addressCheck";

export const dynamic = "force-dynamic";

// POST /api/offramp/session — open a Coinbase-hosted SELL checkout
// (FurlGateway). The customer picks the payout account and confirms the rate
// on Coinbase's page; FurlPay never sees bank details and never holds funds.
// No credentials → 503 (there is no demo sell).
//
// The server-initiated off-ramp (FurlPay funds a payout to a verified
// beneficiary) is POST /api/offramp with `execute`, not this route.
//
// A RampOrder (flow hosted_checkout, no status feed — Coinbase sends none) is
// created before the provider call and returned as `orderId`.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "offramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const body = await validateBody(req, OfframpSessionSchema);
  if (body instanceof NextResponse) return body;

  // Hosted: Coinbase runs KYC and the payout; FurlPay's identity tiers do not apply.
  const rampAuth: RampAuth = { type: "user", user: account.user, jti: auth.claims.jti };
  const guard = await rampGuard({
    req,
    auth: rampAuth,
    direction: "offramp",
    flowType: "hosted",
    amountUsd: body.cryptoAmount,
    destinationAddress: body.address,
    chain: body.chain as Chain,
  });
  if (!guard.pass) return guard.response;

  if (coinbaseRampBackend === "none") {
    return NextResponse.json({ error: "not_available", detail: "Selling crypto isn't available yet." }, { status: 503 });
  }
  if (!isCoinbaseRampChain(body.chain)) {
    return NextResponse.json({ error: "not_quotable", detail: `Selling on ${body.chain} is not supported.` }, { status: 422 });
  }

  const order = await createRampOrder({
    providerId: "furlgateway",
    direction: "offramp",
    flowKind: "hosted_checkout",
    statusFeed: false,
    userId: account.user.id,
    cryptoAsset: body.token,
    cryptoAmount: String(body.cryptoAmount),
    chain: body.chain,
  });

  let hosted;
  try {
    hosted = await coinbaseOfframpUrl({
      address: body.address,
      chain: body.chain,
      asset: body.token,
      cryptoAmount: body.cryptoAmount,
      partnerUserRef: order.orderId,
      redirectUrl: body.redirectUrl,
    });
  } catch (e) {
    console.error("[offramp] coinbase hosted url failed:", (e as Error).message);
    await updateRampOrderStatus(order.orderId, { to: "FAILED", trigger: "system", evidence: "Provider did not return a checkout." }).catch(() => {});
    return NextResponse.json({ error: "provider_error" }, { status: 502 });
  }
  if (!hosted) {
    await updateRampOrderStatus(order.orderId, { to: "FAILED", trigger: "system", evidence: "No checkout for this corridor." });
    return NextResponse.json({ error: "not_quotable" }, { status: 422 });
  }
  await attachCheckout(order.orderId, { checkoutUrl: hosted.url });
  await updateRampOrderStatus(order.orderId, { to: "PAYMENT_PENDING", trigger: "system", evidence: "Hosted sell checkout opened." });

  await recordRampAudit({
    userId: account.user.id,
    action: "offramp.session.created",
    direction: "offramp",
    orderId: order.orderId,
    guardId: guard.meta.guardId,
    amount: { value: String(body.cryptoAmount), currency: body.token },
    ip: trustedClientIp(req) ?? undefined,
    country: guard.meta.country ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    kycTier: account.user.kycTier ?? 0,
    velocityFlags: guard.meta.velocityFlags,
    providerSelected: "furlgateway",
    metadata: { chain: body.chain, token: body.token },
  }).catch(() => {});

  rampCommit({ auth: rampAuth, amountUsd: body.cryptoAmount, country: guard.meta.country }).catch(() => {});

  return NextResponse.json({ orderId: order.orderId, hosted, flags: guard.meta.flags }, { status: 201 });
}
