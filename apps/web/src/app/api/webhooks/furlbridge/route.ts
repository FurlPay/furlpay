import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { kvSetNx } from "@/lib/kv";
import { verifyFurlBridgeWebhook, WebhookSignatureError } from "@/lib/ramp/webhookVerify";
import { recordRampAudit } from "@/lib/ramp/rampAudit";

export const dynamic = "force-dynamic";

// POST /api/webhooks/furlbridge — order events from FurlBridge (Transak).
//
// Verification is Transak's documented scheme — an HS256 JWT in the body's
// `data` field keyed with the Partner Access Token (lib/ramp/webhookVerify.ts).
// Fails closed (401) when the token is unset or the signature does not match.
//
// WHAT THIS DOES NOT DO YET: credit anyone. FurlPay persists no ramp orders —
// /api/onramp/session returns a provider checkout and keeps no durable record
// — so there is nothing to transition. Events are verified, de-duplicated and
// audited, which is the evidence trail a lifecycle wiring will start from. That
// gap is why ONRAMP_LIVE stays `unimplemented` (lib/flags.ts).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "webhook.furlbridge", { limit: 100, windowMs: 60_000 });
  if (limited) return limited;

  const rawBody = await req.text();
  if (rawBody.length > 100_000) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let event;
  try {
    event = verifyFurlBridgeWebhook(rawBody);
  } catch (e) {
    const msg = e instanceof WebhookSignatureError ? e.message : "verification error";
    await recordRampAudit({ userId: "system", action: "webhook.rejected", direction: "onramp", error: msg });
    return NextResponse.json({ error: "signature_invalid" }, { status: 401 });
  }

  // Transak retries on non-2xx and its eventID is an event TYPE, so the dedupe
  // key is (order, event, status). A replay inside the window is acknowledged
  // without a second audit row.
  const first = await kvSetNx(`ramp:webhook:furlbridge:${event.dedupeKey}`, 1, 30 * 24 * 3600);
  if (!first) return NextResponse.json({ received: true, duplicate: true });

  await recordRampAudit({
    userId: "system",
    action: "webhook.received",
    direction: event.webhookData.isBuyOrSell === "SELL" ? "offramp" : "onramp",
    orderId: event.partnerOrderId,
    providerRef: event.orderId,
    providerSelected: "furlbridge",
    metadata: {
      eventType: event.eventType,
      status: event.status,
      transactionHash: event.transactionHash,
      createdAt: event.createdAt,
    },
  });

  return NextResponse.json({ received: true });
}
