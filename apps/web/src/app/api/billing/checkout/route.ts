import { publicOrigin } from "@/lib/publicOrigin";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import { setSubscriptionTier } from "@/lib/store";
import { TIER_BY_PLAN } from "@/lib/entitlements";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import type { UserAccount } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  plan: z.enum(["pro", "developer"]),
});

// POST /api/billing/checkout — start a subscription upgrade.
// body: { plan: "pro" | "developer" }
//
// Chrome Web Store has no payment rails, so subscriptions run through Stripe
// Checkout (playbook §4). With STRIPE_SECRET_KEY + STRIPE_PRICE_<PLAN> set we
// create a real subscription Checkout Session; without them (local sandbox)
// we upgrade the tier immediately so the full flow stays demoable.
export async function POST(req: NextRequest) {
  // requireUser (not a bare verifySession) so a DELETED or LOCKED account cannot
  // start a checkout on a still-valid session — the deletion tombstone and the
  // account-lock check live in requireUser, and every other authenticated route
  // goes through it.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "billing.checkout", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;
  const tier = TIER_BY_PLAN[body.plan];
  if (tier === "Standard") {
    return NextResponse.json({ error: "plan must be 'pro' or 'developer'" }, { status: 400 });
  }

  // Scope the key per user so one client's key can't replay (or conflict with)
  // another account's request.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "billing.checkout", async () =>
    startCheckout(account, body.plan, tier, publicOrigin(req), idempotencyKey)
  , { principal: account.user.id, request: body });
}

async function startCheckout(
  account: UserAccount,
  plan: "pro" | "developer",
  tier: Exclude<(typeof TIER_BY_PLAN)[keyof typeof TIER_BY_PLAN], "Standard">,
  origin: string,
  idempotencyKey: string | null
): Promise<NextResponse> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];

  if (secretKey && priceId) {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: account.user.email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/pricing?upgraded=${plan}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing?cancelled=1`,
        metadata: { furlpayUserId: account.user.id, plan },
        subscription_data: { metadata: { furlpayUserId: account.user.id, plan } },
      },
      // Defense in depth: Stripe dedupes natively too, so a retry that races
      // our KV claim still can't create a second subscription session.
      idempotencyKey ? { idempotencyKey: `${account.user.id}:${idempotencyKey}` } : undefined
    );
    audit("billing.checkout_created", account.user.id, { plan, session: session.id });
    return NextResponse.json({ url: session.url, sandbox: false });
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
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
