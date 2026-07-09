import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAccountDurable, setSubscriptionTier } from "@/lib/store";
import { TIER_BY_PLAN } from "@/lib/entitlements";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout — start a subscription upgrade.
// body: { plan: "pro" | "developer" }
//
// Chrome Web Store has no payment rails, so subscriptions run through Stripe
// Checkout (playbook §4). With STRIPE_SECRET_KEY + STRIPE_PRICE_<PLAN> set we
// create a real subscription Checkout Session; without them (local sandbox)
// we upgrade the tier immediately so the full flow stays demoable.
export async function POST(req: NextRequest) {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const account = await getAccountDurable(claims?.sub);
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { plan } = (await req.json().catch(() => ({}))) as { plan?: string };
  const tier = plan ? TIER_BY_PLAN[plan] : undefined;
  if (!tier || tier === "Standard") {
    return NextResponse.json({ error: "plan must be 'pro' or 'developer'" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[`STRIPE_PRICE_${plan!.toUpperCase()}`];

  if (secretKey && priceId) {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: account.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pricing?upgraded=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?cancelled=1`,
      metadata: { furlpayUserId: account.user.id, plan: plan! },
      subscription_data: { metadata: { furlpayUserId: account.user.id, plan: plan! } },
    });
    audit("billing.checkout_created", account.user.id, { plan, session: session.id });
    return NextResponse.json({ url: session.url, sandbox: false });
  }

  // Sandbox: no Stripe keys — apply the upgrade directly so the flow works
  // end-to-end in local/dev environments.
  setSubscriptionTier(account.user.id, tier);
  audit("billing.sandbox_upgrade", account.user.id, { plan, tier });
  return NextResponse.json({
    url: `${origin}/pricing?upgraded=${plan}&sandbox=1`,
    sandbox: true,
    tier,
  });
}
