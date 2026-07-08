import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { evaluateStablecoin } from "@furlpay/compliance";
import { getAccount, newTx, recordTransaction, DEMO_USER_ID } from "@/lib/store";
import { tryBegin, markProcessed, markFailed, resolveVersion, endpointSecret } from "@/lib/webhookGuard";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

// POST /api/webhooks/bridge — Bridge.xyz stablecoin deposit / payout state changes.
// Verifies the furlpay-signature header before trusting the payload.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = endpointSecret(process.env.FURLPAY_ENDPOINT_SECRET, "whsec_sandbox_bridge");
  if (!secret) {
    // Production without a real secret: verifying against the public sandbox
    // fallback would accept forged events. Fail closed.
    return NextResponse.json({ error: "webhook_secret_unconfigured" }, { status: 503 });
  }

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Idempotency: claim the id; only mark processed after the handler succeeds
  // so a failed handler is retried by the provider instead of lost.
  const version = resolveVersion(req.headers.get("furlpay-version"));
  if (!tryBegin(event.id)) {
    return NextResponse.json({ received: true, deduped: true, version });
  }

  try {
    if (event.type === "deposit.settled") {
      const { token, amountUsd, furlpayUserId } = event.data;
      const target =
        getAccount(typeof furlpayUserId === "string" ? furlpayUserId : undefined) ??
        (process.env.NODE_ENV !== "production" ? getAccount(DEMO_USER_ID) : undefined);
      if (!target) {
        // Ack (don't retry forever) but never credit an unmatched deposit to
        // someone else's account.
        log.warn("bridge deposit.settled without resolvable user", { event: event.id, furlpayUserId });
        markProcessed(event.id);
        return NextResponse.json({ received: true, unmatched: true });
      }

      // Apply MiCA/GENIUS routing to inbound deposits.
      const policy = evaluateStablecoin(token, target.user.region as any);
      const finalToken = policy.allowed ? token : policy.routedTo!;
      recordTransaction(
        target.user.id,
        newTx({
          category: "ramp",
          direction: "in",
          title: `Deposit ${finalToken}`,
          subtitle: policy.allowed ? `Bridge · ${token}` : `Bridge · ${policy.reason}`,
          amountUsd,
          token: finalToken,
          status: "settled",
        })
      );
      audit("webhook.processed", target.user.id, { provider: "bridge", event: event.type, amountUsd });
      markProcessed(event.id);
      return NextResponse.json({ received: true, routed: !policy.allowed, policy });
    }

    markProcessed(event.id);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    markFailed(event.id);
    log.error("bridge webhook handler failed", { event: event.type, error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
