import { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "@/lib/clientIp";
import { quoteFx } from "@/lib/services/fx";
import { newTx, recordTransaction } from "@/lib/store";
import { recordMovement } from "@/lib/ledger";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { OfframpSchema, parse } from "@/lib/schemas";
import { rampGuard, rampCommit, STEP_UP_THRESHOLD_USD, type RampAuth } from "@/lib/ramp/rampGuard";
import { consumeStepUp } from "@/lib/stepup";
import { recordRampAudit } from "@/lib/ramp/rampAudit";
import { flagEnabled } from "@/lib/flags";
import { selectProvider } from "@/lib/providers/router";
import { registerProviders } from "@/lib/providers/register";
import { Money, assetById } from "@/lib/money/money";
import type { OfframpProviderAdapter } from "@/lib/providers/types";
import { rampAttribution } from "@/lib/providers/rampEnv";
import { checkBeneficiaryEligibility } from "@/lib/ramp/beneficiary";
import { attachCheckout, createRampOrder, updateRampOrderStatus, type RampProviderId } from "@/lib/ramp/rampOrder";

export const dynamic = "force-dynamic";

// Ensure adapters are registered.
registerProviders();

// POST /api/offramp — quote / execute a stablecoin→fiat off-ramp.
// body: { fromCurrency, toCurrency, amount, execute? }
//
// TWO PATHS:
//   A. OFFRAMP_LIVE is ON + execute → requires a VERIFIED beneficiary owned by
//      the caller; the router selects an adapter, which opens an order and
//      returns a deposit address. Nothing is debited and nothing is "executed"
//      here: the payout happens when the user's deposit lands and the provider
//      reports it. OFFRAMP_LIVE is `unimplemented` today (lib/flags.ts), so
//      this branch is unreachable until a beneficiary verifier exists.
//   B. OFFRAMP_LIVE is OFF → demo FX quote + demo ledger execution (non-prod).
//      Production with OFFRAMP_LIVE off returns 503 on execute.
//
// Security controls:
//   1. Authentication required (session token)
//   2. Rate limiting (30/min per-user — AGENTS.md Rule 2)
//   3. Zod body validation with positive amount + $50K upper bound (Rule 1)
//   4. rampGuard: embargoed countries, KYC tier 2 (off-ramp), amount limit,
//      velocity check (burst/daily/geo)
//   5. Step-up on execute (action "withdraw", value-gated like transfers)
//   6. Audit trail
//   7. Velocity commit after execution
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "offramp", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = parse(OfframpSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { fromCurrency, toCurrency, amount, execute, beneficiaryId } = parsed.data;

  // Quotes need no identity tier; executing is server-initiated (FurlPay funds
  // the payout), so the full guard applies: KYC Tier 2, velocity, and a fresh
  // session step-up at $5,000 or more.
  const rampAuth: RampAuth = { type: "user", user: account.user, jti: auth.claims.jti };
  let guard: Awaited<ReturnType<typeof rampGuard>> | null = null;
  if (execute) {
    guard = await rampGuard({ req, auth: rampAuth, direction: "offramp", flowType: "server-initiated", amountUsd: amount });
    if (!guard.pass) return guard.response;
  }
  const guardMeta = guard?.pass ? guard.meta : null;

  // ── Audit: quote requested ───────────────────────────────────────────
  recordRampAudit({
    userId: account.user.id,
    action: "offramp.quote.requested",
    direction: "offramp",
    guardId: guardMeta?.guardId,
    amount: { value: String(amount), currency: fromCurrency },
    ip: trustedClientIp(req) ?? undefined,
    country: guardMeta?.country ?? undefined,
    kycTier: account.user.kycTier ?? 0,
    velocityFlags: guardMeta?.velocityFlags,
  }).catch(() => {});

  const quote = await quoteFx(fromCurrency, toCurrency, amount);

  // ── Provider router path (when OFFRAMP_LIVE and execute) ──────────────
  if (execute && flagEnabled("OFFRAMP_LIVE")) {
    // The account the money goes to must be named, verified and the caller's.
    // An earlier draft passed beneficiaryRef "default" — paying whatever the
    // provider had on file, which is how a substituted beneficiary gets paid.
    if (!beneficiaryId) {
      return NextResponse.json({ error: "beneficiary_required" }, { status: 400 });
    }
    const eligibility = await checkBeneficiaryEligibility(beneficiaryId, account.user.id);
    if (!eligibility.eligible) {
      return NextResponse.json(
        {
          error: "beneficiary_not_eligible",
          detail: eligibility.reason,
          ...("action" in eligibility && eligibility.action ? { action: eligibility.action } : {}),
        },
        { status: 400 }
      );
    }

    // Corridors are per-country; an unknown country is not "US".
    const country = guardMeta?.country ?? null;
    if (!country) {
      return NextResponse.json({ error: "country_unknown", detail: "Your country could not be determined." }, { status: 400 });
    }
    const fromAsset = assetById(fromCurrency);
    if (!fromAsset) {
      return NextResponse.json({ error: "unsupported_currency" }, { status: 400 });
    }
    const paymentMethod = "bank_transfer" as import("@/lib/providers/types").PaymentMethod;
    const amountMinor = BigInt(Math.round(amount * 10 ** fromAsset.decimals));
    const selection = selectProvider({
      kind: "offramp",
      direction: "offramp",
      country,
      fiatCurrency: toCurrency,
      assetId: fromCurrency,
      paymentMethod,
      amountMinor,
    });
    if (!selection.selected) {
      return NextResponse.json(
        { error: "no_provider", detail: "No off-ramp provider is available for this corridor." },
        { status: 503 }
      );
    }

    const adapter = selection.selected.adapter as OfframpProviderAdapter;
    if (adapter.hasHostedCheckout) {
      // A hosted sell runs on the provider's page: POST /api/offramp/session.
      return NextResponse.json({ error: "use_hosted_session", detail: "Use /api/offramp/session for this provider." }, { status: 409 });
    }
    // The order exists before the provider is called; its id is the provider's
    // partner reference. The beneficiary travels as OUR reference only: bank
    // details are not sent to an adapter whose API is unverified, and a
    // provider that needs them collects them itself.
    const rampOrder = await createRampOrder({
      providerId: adapter.id as RampProviderId,
      direction: "offramp",
      flowKind: "offramp",
      statusFeed: adapter.id === "furlbridge",
      userId: account.user.id,
      beneficiaryId,
      fiatCurrency: toCurrency,
      cryptoAsset: fromAsset.symbol,
      cryptoAmount: String(amount),
      chain: fromAsset.chain ?? "unspecified",
    });
    const orderId = rampOrder.orderId;
    let order;
    try {
      const providerQuote = await adapter.quote({
        from: Money.ofMinor(amountMinor, fromAsset),
        toAssetId: toCurrency,
        paymentMethod,
        countryCode: country,
        userRef: account.user.id,
      });
      order = await adapter.createOrder({
        orderId,
        idempotencyKey: `offramp_${orderId}`,
        quote: providerQuote,
        beneficiaryRef: beneficiaryId,
        userRef: account.user.id,
        countryCode: country,
      });
    } catch (e) {
      // The provider's message stays in the server log; the client gets a code.
      console.error(`[offramp] ${adapter.id} order failed:`, (e as Error).message);
      await updateRampOrderStatus(orderId, { to: "FAILED", trigger: "system", evidence: "Provider refused the order." }).catch(() => {});
      return NextResponse.json({ error: "provider_error" }, { status: 502 });
    }
    await attachCheckout(orderId, { depositAddress: order.depositAddress });
    await updateRampOrderStatus(orderId, { to: "QUOTED", trigger: "system", evidence: "Provider order opened; awaiting the customer's deposit." });

    await recordRampAudit({
      userId: account.user.id,
      action: "offramp.session.created",
      direction: "offramp",
      orderId,
      guardId: guardMeta?.guardId,
      amount: { value: String(amount), currency: fromCurrency },
      ip: trustedClientIp(req) ?? undefined,
      country,
      userAgent: req.headers.get("user-agent") ?? undefined,
      kycTier: account.user.kycTier ?? 0,
      velocityFlags: guardMeta?.velocityFlags,
      providerSelected: adapter.id,
      providerRef: order.providerRef,
      metadata: { toCurrency, beneficiaryId },
    }).catch(() => {});

    // Counted at order creation: the user is about to send funds, and a
    // velocity limit that waits for settlement can be outrun.
    rampCommit({ auth: rampAuth, amountUsd: amount, country }).catch(() => {});
    // Step-up is single-use: one ceremony, one payout.
    if (amount >= STEP_UP_THRESHOLD_USD) await consumeStepUp(account.user.id, auth.claims.jti);

    return NextResponse.json(
      {
        quote,
        orderId,
        executed: false,
        status: "awaiting_deposit",
        provider: {
          id: adapter.id,
          company: rampAttribution(adapter.id)?.company ?? null,
          ref: order.providerRef,
          depositAddress: order.depositAddress,
          depositChain: order.depositChain,
          providerStatus: order.outcome.providerStatus,
        },
      },
      { status: 202 }
    );
  }

  // ── Demo/legacy path (no OFFRAMP_LIVE or no execute) ──────────────────
  if (execute && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "Off-ramp execution is not enabled on this deployment. Quotes remain available." },
      { status: 503 }
    );
  }

  if (execute) {
    // LEDGER FIRST — demo path.
    await recordMovement("out", amount, `Off-ramp to ${toCurrency} via ${quote.rail}`, account.user.id);

    recordTransaction(
      account.user.id,
      newTx({
        category: "ramp",
        direction: "out",
        title: `Off-ramp to ${toCurrency}`,
        subtitle: `Wise · ${quote.rail} · ${quote.feePct}% fee`,
        amountUsd: amount,
        status: "settled",
      })
    );
    const fiat = account.fiatBalances.find((f) => f.currency === toCurrency);
    if (fiat) {
      fiat.amount += quote.amountTo;
    }

    await recordRampAudit({
      userId: account.user.id,
      action: "offramp.executed",
      direction: "offramp",
      guardId: guardMeta?.guardId,
      amount: { value: String(amount), currency: fromCurrency },
      ip: trustedClientIp(req) ?? undefined,
      country: guardMeta?.country ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
      kycTier: account.user.kycTier ?? 0,
      velocityFlags: guardMeta?.velocityFlags,
      metadata: {
        toCurrency,
        amountTo: quote.amountTo,
        rail: quote.rail,
        feePct: quote.feePct,
      },
    }).catch(() => {});

    rampCommit({ auth: rampAuth, amountUsd: amount, country: (guardMeta?.country ?? null) }).catch(() => {});
  }

  return NextResponse.json({ quote, executed: !!execute });
}
