// ---------------------------------------------------------------------------
// POST /api/webhooks/complyadvantage — ComplyAdvantage AML/PEP screening webhooks
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/validate";
import { ComplyAdvantageProvider } from "@/lib/compliance/providers/complyAdvantage";
import { kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import { audit } from "@/lib/audit";

const ca = new ComplyAdvantageProvider();

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readTextBody(req);
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

    log.info("ComplyAdvantage webhook processed", { eventId, referenceId: payload.referenceId });
    audit("webhook.processed", payload.referenceId || "system", {
      provider: "complyadvantage",
      eventType: payload.eventType,
      status: payload.status,
    });

    return NextResponse.json({ status: "ok", eventId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook processing failed";
    log.error("ComplyAdvantage webhook handler failed", { error: msg });
    // Signature/configuration/parser details help an attacker tune requests and
    // must not be reflected from an unauthenticated endpoint.
    return NextResponse.json({ error: "invalid_webhook" }, { status: 400 });
  }
}
