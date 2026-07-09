import { NextResponse } from "next/server";
import crypto from "crypto";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { suppressEmail } from "@/lib/email";
import { log } from "@/lib/log";

// POST /api/webhooks/resend — delivery feedback (bounces, complaints, failures).
// Hard bounces and spam complaints feed the KV suppression list so we stop
// sending to those addresses — continuing is how a sending domain's reputation
// dies. Resend signs webhooks with the Svix scheme; verified here with plain
// HMAC (no SDK): base64 secret after "whsec_", signed content "{id}.{ts}.{body}",
// header carries space-separated "v1,<base64>" candidates. Node runtime for crypto.
export const runtime = "nodejs";

const TOLERANCE_SECONDS = 5 * 60;

function verifySvixSignature(payload: string, req: Request, secret: string): boolean {
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signatures = req.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");

  return signatures.split(" ").some((candidate) => {
    const sig = candidate.split(",")[1] ?? "";
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const payload = await req.text();
  if (!verifySvixSignature(payload, req, secret)) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = req.headers.get("svix-id")!;
  if (!(await tryBegin(`resend:${eventId}`))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    const type: string = event.type ?? "";
    const recipients: string[] = Array.isArray(event.data?.to) ? event.data.to : [];

    if (type === "email.bounced") {
      // Transient bounces (full mailbox, greylisting) resolve on their own;
      // only permanent ones poison future sends.
      const bounceType = String(event.data?.bounce?.type ?? "").toLowerCase();
      if (bounceType !== "transient") {
        for (const addr of recipients) await suppressEmail(addr, "bounced");
        log.warn("email suppressed after bounce", { recipients, subType: event.data?.bounce?.subType });
      }
    } else if (type === "email.complained") {
      // A spam complaint is a permanent opt-out signal.
      for (const addr of recipients) await suppressEmail(addr, "complained", 365 * 86_400);
      log.warn("email suppressed after complaint", { recipients });
    } else if (type === "email.failed") {
      log.error("email send failed at provider", { recipients, reason: event.data?.failed?.reason });
    }

    await markProcessed(`resend:${eventId}`);
    return NextResponse.json({ received: true });
  } catch (e) {
    await markFailed(`resend:${eventId}`);
    log.error("resend webhook handler failed", { error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
