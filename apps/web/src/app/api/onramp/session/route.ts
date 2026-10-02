import { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "@/lib/clientIp";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { OnrampSessionSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { createOnrampSession } from "@/lib/services/onramp";
import { coinbaseOnrampUrl, coinbaseRampBackend } from "@/lib/services/coinbaseRamp";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { rampGuard, rampCommit } from "@/lib/ramp/rampGuard";
import { recordRampAudit } from "@/lib/ramp/rampAudit";
import { flagEnabled } from "@/lib/flags";
import { selectProvider } from "@/lib/providers/router";
import { registerProviders } from "@/lib/providers/register";
import { Money, assetById } from "@/lib/money/money";
import { rampAttribution } from "@/lib/providers/rampEnv";
import { enforceActionStepUp } from "@/lib/biometrics/enforceStepUp";
import { attachCheckout, createRampOrder, updateRampOrderStatus, type RampProviderId } from "@/lib/ramp/rampOrder";
import type { OnrampProviderAdapter, PaymentMethod } from "@/lib/providers/types";
import type { Chain } from "@/lib/security/addressCheck";

export const dynamic = "force-dynamic";

registerProviders();

// POST /api/onramp/session — open an on-ramp checkout. Consumed by the FurlPay
// apps and @furlpay/elements/onramp.
//
// PROVIDER
//   A. ONRAMP_LIVE on → the router picks the adapter for the corridor
//      (`unimplemented` today, lib/flags.ts).
//   B. Otherwise → the Coinbase-hosted checkout when FurlGateway (CDP)
//      credentials are set.
//   C. Neither → production 503; development returns the demo session only.
//
// ORDER RECORD (lib/ramp/rampOrder.ts). Whenever a provider is involved, a
// RampOrder is created BEFORE the provider call, so a provider that answers
// and a process that then dies still leaves a record. The provider is handed
// our orderId (Transak `partnerOrderId`, Coinbase `partnerUserRef`), which is
// how its webhooks find the order. Provider failure → order FAILED, 502.
// Checkout minted → PAYMENT_PENDING, and `orderId` is returned to the client.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const body = await validateBody(req, OnrampSessionSchema);
  if (body instanceof NextResponse) return body;

  const routerOn = flagEnabled("ONRAMP_LIVE");
  if (coinbaseRampBackend === "none" && !routerOn) {
    const unavailable = demoOnlyUnavailable("Buying crypto", "No on-ramp provider is configured.");
    if (unavailable) return unavailable;
  }

  const guard = await rampGuard({
    req,
    user: account.user,
    direction: "onramp",
    amountUsd: body.fiatAmount,
    destinationAddress: body.destinationAddress,
    chain: body.chain as Chain,
  });
  if (!guard.pass) return guard.response;

  const stepUp = await enforceActionStepUp({
    userId: account.user.id,
    action: "create_payment",
    amountUsd: body.fiatAmount,
    endpoint: "/onramp/session",
    method: "POST",
    body: body as unknown as Parameters<typeof enforceActionStepUp>[0]["body"],
    proofId: body.stepUpProofId,
  });
  if (stepUp) return stepUp;

  // Demo session: development only (the gate above refuses production).
  const session = createOnrampSession({
    fiatAmount: body.fiatAmount,
    fiatCurrency: body.fiatCurrency,
    token: body.token,
    chain: body.chain,
    paymentMethod: body.paymentMethod ?? "card",
    destinationAddress: body.destinationAddress,
    externalId: body.externalId,
  });

  const fiatAsset = assetById(body.fiatCurrency);
  const decimals = fiatAsset?.decimals ?? 2;
  const amountMinor = BigInt(Math.round(body.fiatAmount * 10 ** decimals));
  const paymentMethod = (body.paymentMethod ?? "card") as PaymentMethod;

  // ── Pick the provider ────────────────────────────────────────────────
  let adapter: OnrampProviderAdapter | null = null;
  if (routerOn) {
    const country = guard.meta.country;
    if (!country) {
      return NextResponse.json({ error: "country_unknown", detail: "Your country could not be determined." }, { status: 400 });
    }
    const selection = selectProvider({
      kind: "onramp",
      direction: "onramp",
      country,
      fiatCurrency: body.fiatCurrency,
      assetId: `${body.token}.${body.chain}`,
      paymentMethod,
      amountMinor,
    });
    adapter = (selection.selected?.adapter as OnrampProviderAdapter | undefined) ?? null;
  }
  const providerId: RampProviderId | null = adapter
    ? (adapter.id as RampProviderId)
    : coinbaseRampBackend === "coinbase"
      ? "furlgateway"
      : null;

  // ── Record the order, then call the provider ─────────────────────────
  const order = providerId
    ? await createRampOrder({
        providerId,
        direction: "onramp",
        flowKind: adapter && !adapter.hasHostedCheckout ? "onramp" : "hosted_checkout",
        // Only FurlBridge pushes status (its webhook). Coinbase sends none.
        statusFeed: providerId === "furlbridge",
        userId: account.user.id,
        fiatCurrency: body.fiatCurrency,
        fiatAmountMinor: Number(amountMinor),
        cryptoAsset: body.token,
        chain: body.chain,
        destinationAddress: body.destinationAddress,
      })
    : null;

  let checkoutUrl: string | undefined;
  let hosted = null;
  try {
    if (adapter && order) {
      const quote = await adapter.quote({
        from: Money.ofMinor(amountMinor, fiatAsset!),
        toAssetId: `${body.token}.${body.chain}`,
        paymentMethod,
        countryCode: guard.meta.country!,
        userRef: account.user.id,
      });
      const placed = await adapter.createOrder({
        orderId: order.orderId,
        idempotencyKey: `onramp_${order.orderId}`,
        quote,
        destinationAddress: body.destinationAddress,
        destinationChain: body.chain,
        userRef: account.user.id,
        countryCode: guard.meta.country!,
      });
      checkoutUrl = placed.checkoutUrl;
    } else if (order) {
      hosted = await coinbaseOnrampUrl({
        address: body.destinationAddress,
        chain: body.chain,
        asset: body.token,
        fiatAmount: body.fiatAmount,
        fiatCurrency: body.fiatCurrency,
        partnerUserRef: order.orderId,
      });
      checkoutUrl = hosted?.url;
    }
  } catch (e) {
    console.error(`[onramp] ${providerId} checkout failed:`, (e as Error).message);
    if (order) {
      await updateRampOrderStatus(order.orderId, {
        to: "FAILED",
        trigger: "system",
        evidence: "Provider did not return a checkout.",
      }).catch(() => {});
    }
    return NextResponse.json({ error: "provider_error" }, { status: 502 });
  }

  if (order) {
    if (!checkoutUrl) {
      // Coinbase does not serve this chain/asset: nothing was opened.
      await updateRampOrderStatus(order.orderId, { to: "FAILED", trigger: "system", evidence: "No checkout for this corridor." });
      return NextResponse.json({ error: "not_quotable", detail: `No checkout for ${body.token} on ${body.chain}.` }, { status: 422 });
    }
    await attachCheckout(order.orderId, { checkoutUrl });
    await updateRampOrderStatus(order.orderId, { to: "PAYMENT_PENDING", trigger: "system", evidence: "Hosted checkout opened." });
  }

  await recordRampAudit({
    userId: account.user.id,
    action: "onramp.session.created",
    direction: "onramp",
    orderId: order?.orderId ?? session.id,
    guardId: guard.meta.guardId,
    amount: { value: String(body.fiatAmount), currency: body.fiatCurrency },
    ip: trustedClientIp(req) ?? undefined,
    country: guard.meta.country ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    kycTier: account.user.kycTier ?? 0,
    velocityFlags: guard.meta.velocityFlags,
    providerSelected: providerId ?? "demo",
    metadata: { chain: body.chain, token: body.token, destinationAddress: body.destinationAddress },
  }).catch(() => {});

  if (order) {
    rampCommit({ userId: account.user.id, amountUsd: body.fiatAmount, country: guard.meta.country }).catch(() => {});
  }

  return NextResponse.json(
    {
      ...session,
      orderId: order?.orderId ?? null,
      hosted,
      ...(adapter &&
        checkoutUrl && {
          provider: { providerId: adapter.id, checkoutUrl, company: rampAttribution(adapter.id)?.company ?? null },
        }),
    },
    { status: 201 }
  );
}
