// ---------------------------------------------------------------------------
// POST /api/webhooks/complyadvantage — ComplyAdvantage AML/PEP screening webhooks
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { ComplyAdvantageProvider } from "@/lib/compliance/providers/complyAdvantage";
import { kvSet } from "@/lib/kv";

const ca = new ComplyAdvantageProvider();

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("complyadvantage-signature") ?? req.headers.get("x-signature") ?? "";

    if (!signature) {
      return NextResponse.json({ error: "Missing signature header" }, { status: 400 });
    }

    const payload = await ca.verifyWebhook(rawBody, signature);

    // Store event in KV for audit / async review worker processing
    const eventId = crypto.randomUUID();
    await kvSet(`webhook:complyadvantage:${eventId}`, {
      eventId,
      ...payload,
      receivedAt: Date.now(),
    });

    return NextResponse.json({ status: "ok", eventId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook processing failed";
    console.error("ComplyAdvantage webhook error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
