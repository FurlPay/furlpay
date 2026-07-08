import { NextRequest, NextResponse } from "next/server";
import { constructEvent } from "@furlpay/compliance";
import { getAccount, newTx, recordTransaction, DEMO_USER_ID } from "@/lib/store";
import { tryBegin, markProcessed, markFailed, endpointSecret } from "@/lib/webhookGuard";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

// POST /api/webhooks/wise — incoming bank transfer notifications (Wise / BaaS).
export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = endpointSecret(process.env.FURLPAY_ENDPOINT_SECRET, "whsec_sandbox_wise");
  if (!secret) {
    return NextResponse.json({ error: "webhook_secret_unconfigured" }, { status: 503 });
  }

  let event;
  try {
    event = constructEvent<any>(body, req.headers.get("furlpay-signature"), secret);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!tryBegin(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    if (event.type === "transfer.credited") {
      const { currency, amount, usdValue, furlpayUserId } = event.data;
      const target =
        getAccount(typeof furlpayUserId === "string" ? furlpayUserId : undefined) ??
        (process.env.NODE_ENV !== "production" ? getAccount(DEMO_USER_ID) : undefined);
      if (!target) {
        log.warn("wise transfer.credited without resolvable user", { event: event.id, furlpayUserId });
        markProcessed(event.id);
        return NextResponse.json({ received: true, unmatched: true });
      }

      const acct = target.fiatBalances.find((f) => f.currency === currency);
      if (acct) acct.amount += amount;
      recordTransaction(
        target.user.id,
        newTx({
          category: "ramp",
          direction: "in",
          title: `Bank deposit ${currency}`,
          subtitle: "Wise · incoming transfer",
          amountUsd: usdValue ?? amount,
          status: "settled",
        })
      );
      audit("webhook.processed", target.user.id, { provider: "wise", event: event.type, amount, currency });
    }

    markProcessed(event.id);
    return NextResponse.json({ received: true, type: event.type });
  } catch (e) {
    markFailed(event.id);
    log.error("wise webhook handler failed", { event: event.type, error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
