import { NextResponse } from "next/server";
import { verifyPersonaSignature } from "@/lib/kyc/persona";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { getAccount, setKycStatus } from "@/lib/store";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { sendEmail } from "@/lib/email";
import { kycStatusEmail } from "@/lib/emailTemplates";

// POST /api/webhooks/persona — Persona KYC inquiry outcomes (async liveness).
// Verifies the persona-signature header (constant-time, rotation-aware) before
// updating the user's verification status. Node runtime for crypto.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("persona-signature");
  const secret = process.env.PERSONA_WEBHOOK_SECRET || "";

  if (!verifyPersonaSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Support both the simplified payload shape and Persona's JSON:API envelope.
  const eventType: string = event.eventType ?? event.data?.attributes?.name ?? "";
  const eventData = event.payload?.data ?? event.payload ?? event.data?.attributes?.payload?.data ?? {};
  const attrs = eventData.attributes ?? eventData;

  const eventId = event.id ?? eventData.id ?? signature ?? String(Date.now());
  if (!(await tryBegin(String(eventId)))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    const userId: string | undefined = attrs.referenceId ?? attrs["reference-id"] ?? eventData.referenceId;
    const inquiryId: string | undefined = eventData.id ?? attrs.id;
    const status: string | undefined = attrs.status;

    // referenceId is the FurlPay user id we handed Persona when the inquiry
    // was created; the transition goes through the DEDICATED KYC path (it is
    // deliberately unreachable via the identity-field updateUser allow-list).
    const account = getAccount(userId);
    if (account) {
      if (eventType === "inquiry.completed" || status === "completed") {
        setKycStatus(account.user.id, "verified", 2);
        audit("webhook.processed", account.user.id, { provider: "persona", event: "inquiry.completed", inquiryId });
        if (account.user.email) {
          void sendEmail({
            to: account.user.email,
            category: "kyc",
            idempotencyKey: `kyc-verified-${inquiryId ?? account.user.id}`,
            ...kycStatusEmail({ name: account.user.name, status: "verified", tier: 2 }),
          });
        }
      } else if (eventType === "inquiry.failed" || status === "failed") {
        setKycStatus(account.user.id, "unverified");
        audit("webhook.processed", account.user.id, { provider: "persona", event: "inquiry.failed", inquiryId });
        if (account.user.email) {
          void sendEmail({
            to: account.user.email,
            category: "kyc",
            idempotencyKey: `kyc-failed-${inquiryId ?? account.user.id}`,
            ...kycStatusEmail({ name: account.user.name, status: "unverified" }),
          });
        }
      }
    } else if (userId) {
      log.warn("persona webhook for unknown referenceId", { inquiryId, userId });
    }

    await markProcessed(String(eventId));
    return NextResponse.json({ received: true, inquiryId });
  } catch (e) {
    await markFailed(String(eventId));
    log.error("persona webhook handler failed", { error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
