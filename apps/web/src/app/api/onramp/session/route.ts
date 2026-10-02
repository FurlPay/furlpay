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
import type { OnrampProviderAdapter } from "@/lib/providers/types";
import type { Chain } from "@/lib/security/addressCheck";

export const dynamic = "force-dynamic";

// Ensure adapters are registered on first request.
registerProviders();

// POST /api/onramp/session — mint a headless on-ramp session the partner
// confirms with its own payment sheet. Consumed by @furlpay/elements/onramp.
//
// TWO PATHS:
//   A. ONRAMP_LIVE is ON → provider router selects the adapter for the
//      corridor and opens a provider checkout. A provider failure is a 502,
//      never a quiet fall back to a session that cannot be paid.
//      ONRAMP_LIVE is `unimplemented` today (lib/flags.ts).
//   B. ONRAMP_LIVE is OFF → session record + Coinbase-hosted checkout URL when
//      FurlGateway (CDP) credentials are set. Coinbase is the provider of
//      record there; the response names it (`company`).
//
// Security controls (all from the security report):
//   1. Rate limiting (10 req/10 min — money-moving, AGENTS.md Rule 2)
//   2. Authentication required (session token)
//   3. Zod body validation (Rule 1) — validates address format, amount bounds
//   4. rampGuard: embargoed countries, KYC tier 1+, KYC amount limit,
//      velocity check (burst/daily/geo), destination address verification
//      (poisoning, burn, contract, chain mismatch)
//   5. Step-up (action "create_payment", value-gated like transfers)
//   6. Audit trail
//   7. Velocity commit AFTER order creation (not before — declined attempts
//      must not lock out a victim)
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  // ── 1. Authentication ─────────────────────────────────────────────────
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // ── 2. Zod validation ─────────────────────────────────────────────────
  const body = await validateBody(req, OnrampSessionSchema);
  if (body instanceof NextResponse) return body;

  // With no provider able to take the payment, a session is a checkout nobody
  // can pay. Production says so; development keeps the demo session.
  if (coinbaseRampBackend === "none" && !flagEnabled("ONRAMP_LIVE")) {
    const unavailable = demoOnlyUnavailable("Buying crypto", "No on-ramp provider is configured.");
    if (unavailable) return unavailable;
  }

  // ── 3. Ramp security guard ────────────────────────────────────────────
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

  // ── 4. Create demo session (always, for display parity) ───────────────
  const session = createOnrampSession({
    fiatAmount: body.fiatAmount,
    fiatCurrency: body.fiatCurrency,
    token: body.token,
    chain: body.chain,
    paymentMethod: body.paymentMethod ?? "card",
    destinationAddress: body.destinationAddress,
    externalId: body.externalId,
  });

  // ── 5. Provider router path (when ONRAMP_LIVE) ────────────────────────
  let providerOrder: {
    providerId: string;
    providerRef: string;
    checkoutUrl?: string;
    collectionInstruction?: unknown;
  } | null = null;
  let providerSelected = "demo";

  if (flagEnabled("ONRAMP_LIVE")) {
    // Corridors are per-country; an unknown country is not "US".
    const country = guard.meta.country;
    if (!country) {
      return NextResponse.json({ error: "country_unknown", detail: "Your country could not be determined." }, { status: 400 });
    }
    const fiatAsset = assetById(body.fiatCurrency);
    const paymentMethod = (body.paymentMethod ?? "card") as import("@/lib/providers/types").PaymentMethod;

    if (fiatAsset) {
      const amountMinor = BigInt(Math.round(body.fiatAmount * 10 ** fiatAsset.decimals));
      const selection = selectProvider({
        kind: "onramp",
        direction: "onramp",
        country,
        fiatCurrency: body.fiatCurrency,
        assetId: `${body.token}.${body.chain}`,
        paymentMethod,
        amountMinor,
      });

      if (selection.selected) {
        const adapter = selection.selected.adapter as OnrampProviderAdapter;
        providerSelected = adapter.id;

        try {
          const fromMoney = Money.ofMinor(amountMinor, fiatAsset);
          const quote = await adapter.quote({
            from: fromMoney,
            toAssetId: `${body.token}.${body.chain}`,
            paymentMethod,
            countryCode: country,
            userRef: account.user.id,
          });

          const order = await adapter.createOrder({
            orderId: session.id,
            idempotencyKey: `onramp_${session.id}`,
            quote,
            destinationAddress: body.destinationAddress,
            destinationChain: body.chain,
            userRef: account.user.id,
            countryCode: country,
          });

          providerOrder = {
            providerId: order.providerId,
            providerRef: order.providerRef,
            checkoutUrl: order.checkoutUrl,
            collectionInstruction: order.collectionInstruction,
          };
        } catch (e) {
          console.error(`[onramp] ${adapter.id} order failed:`, (e as Error).message);
          return NextResponse.json({ error: "provider_error" }, { status: 502 });
        }
      }
    }
  }

  // ── 6. Coinbase hosted checkout (best-effort fallback) ─────────────────
  // If the provider router already selected Coinbase, skip the duplicate call.
  let hosted = null;
  if (providerSelected !== "furlgateway") {
    try {
      hosted = await coinbaseOnrampUrl({
        address: body.destinationAddress,
        chain: body.chain,
        asset: body.token,
        fiatAmount: body.fiatAmount,
        fiatCurrency: body.fiatCurrency,
        partnerUserRef: session.id,
      });
    } catch (e) {
      // A configured provider that fails is an outage, not a demo session.
      console.error("[onramp] coinbase hosted url failed:", (e as Error).message);
      return NextResponse.json({ error: "provider_error" }, { status: 502 });
    }
  }

  // ── 7. Audit trail ────────────────────────────────────────────────────
  await recordRampAudit({
    userId: account.user.id,
    action: "onramp.session.created",
    direction: "onramp",
    orderId: session.id,
    guardId: guard.meta.guardId,
    amount: { value: String(body.fiatAmount), currency: body.fiatCurrency },
    ip: trustedClientIp(req) ?? undefined,
    country: guard.meta.country ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    kycTier: account.user.kycTier ?? 0,
    velocityFlags: guard.meta.velocityFlags,
    providerSelected,
    metadata: {
      chain: body.chain,
      token: body.token,
      destinationAddress: body.destinationAddress,
      hostedAvailable: !!hosted,
      routerUsed: flagEnabled("ONRAMP_LIVE"),
      providerOrderRef: providerOrder?.providerRef,
    },
  }).catch(() => {}); // Fire-and-forget — never block money for audit

  // ── 8. Velocity commit (AFTER success, not before) ────────────────────
  rampCommit({
    userId: account.user.id,
    amountUsd: body.fiatAmount,
    country: guard.meta.country,
  }).catch(() => {}); // fail-open

  return NextResponse.json(
    {
      ...session,
      hosted,
      // When the router selected a provider, include its order details.
      ...(providerOrder && {
        provider: { ...providerOrder, company: rampAttribution(providerOrder.providerId)?.company ?? null },
      }),
    },
    { status: 201 }
  );
}

