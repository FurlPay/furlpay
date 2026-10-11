import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/log";
import { BodyTooLarge, readBoundedBody } from "@/lib/settlement/boundedBody";
import { withDurableWebhook } from "@/lib/withDurableWebhook";
import { bvnkWebhookSecret } from "@/lib/bvnk/config";
import { BvnkEventInvalid, parseBvnkEvent, verifyBvnkSignature } from "@/lib/bvnk/webhook";
import { recordFromEvent, upsertBvnkRecord } from "@/lib/bvnk/records";
import { BvnkAmountError } from "@/lib/bvnk/amount";

export const dynamic = "force-dynamic";

// POST /api/webhooks/bvnk — BVNK event intake (docs/integrations/BVNK.md).
//
// Order: bounded raw body → x-signature over those exact bytes → contract
// parse → durable claim on BVNK's eventId (webhook_events, 0022) → record the
// reported state in bvnk_records (0052; newer-wins, so out-of-order delivery
// cannot regress a status). It RECORDS. It never credits a balance, posts to
// the ledger, or starts a payout or transfer: BVNK documents that a payment's
// status must be confirmed through the API before acting on a webhook, and a
// confirmed deposit must never authorise employer payroll by itself.
//
// Responses follow BVNK's retry contract: 2xx acknowledges; 4xx (except 429)
// is not retried, used for bad signatures and events that can never be valid;
// 5xx is retried for about 24 hours, used only for our own transient failures.
const MAX_BODY = 256 * 1024;
const ok = (body: Record<string, unknown>) => NextResponse.json(body, { status: 200 });

export async function POST(req: NextRequest) {
  const secret = bvnkWebhookSecret();
  if (!secret) return NextResponse.json({ error: "bvnk_webhook_not_configured" }, { status: 503 });

  let raw: string;
  try {
    raw = new TextDecoder().decode(await readBoundedBody(req, MAX_BODY));
  } catch (e) {
    return NextResponse.json({ error: e instanceof BodyTooLarge ? "payload_too_large" : "unreadable_body" }, { status: e instanceof BodyTooLarge ? 413 : 400 });
  }
  if (!verifyBvnkSignature(raw, req.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = parseBvnkEvent(raw);
  } catch (e) {
    if (e instanceof BvnkEventInvalid) {
      // Signed by BVNK but not acceptable (stale, malformed or off-contract):
      // permanent, so 422 tells BVNK not to retry. Logged for investigation.
      log.warn("bvnk webhook rejected", { reason: e.message.slice(0, 200) });
      return NextResponse.json({ error: "invalid_event" }, { status: 422 });
    }
    throw e;
  }

  let row;
  try {
    row = recordFromEvent(parsed);
  } catch (e) {
    if (e instanceof BvnkAmountError) {
      log.warn("bvnk webhook amount refused", { event: parsed.event.event, reason: e.message });
      return NextResponse.json({ error: "invalid_amount" }, { status: 422 });
    }
    throw e;
  }

  const outcome = await withDurableWebhook<"recorded" | "stale" | "unhandled" | "duplicate" | "mismatch" | "unavailable">({
    provider: "bvnk",
    eventId: parsed.event.eventId,
    eventType: parsed.event.event,
    rawBody: raw,
    onDuplicate: () => "duplicate",
    onMismatch: () => "mismatch",
    onUnavailable: () => "unavailable",
    handler: async () => {
      if (!row) return "unhandled";
      return (await upsertBvnkRecord(row)) === "stale" ? "stale" : "recorded";
    },
  }).catch((e: Error) => {
    log.error("bvnk webhook processing failed", { event: parsed.event.event, error: e.message.slice(0, 200) });
    return "unavailable" as const;
  });

  if (outcome === "unavailable") return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  if (outcome === "mismatch") {
    // Same eventId, different signed body: never processed twice, and not retried.
    log.error("bvnk webhook eventId reused with a different body", { eventId: parsed.event.eventId });
    return NextResponse.json({ error: "event_id_conflict" }, { status: 409 });
  }
  return ok({ received: true, outcome });
}
