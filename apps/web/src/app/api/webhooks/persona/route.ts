import { NextResponse } from "next/server";
import { recordProductEvent } from "@/lib/analytics/events";
import { createHash } from "crypto";
import { verifyPersonaSignature } from "@/lib/kyc/persona";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { getAccountDurable, setKycStatus } from "@/lib/store";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { sendEmail } from "@/lib/email";
import { kycStatusEmail } from "@/lib/emailTemplates";
import { kycTransitionAllowed, type KycState } from "@/lib/webhookOrdering";
import { resolveKycSession } from "@/lib/compliance/kycBinding";

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

  // The dedup key must be STABLE for a given delivery, or the guard below does
  // nothing. `String(Date.now())` was the last fallback, and it is a different
  // value on every request — so an id-less payload got a fresh key each time and
  // replayed freely past the guard. A content hash is stable by construction and
  // needs nothing from the payload's shape, so it cannot fall through.
  //
  // The signature is kept ahead of it only because it is shorter; it is equally
  // stable for a fixed body. Both are derived from the delivery, never from the
  // clock.
  const eventId =
    event.id ??
    eventData.id ??
    signature ??
    `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  if (!(await tryBegin(String(eventId)))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    const reference: string | undefined = attrs.referenceId ?? attrs["reference-id"] ?? eventData.referenceId;
    const inquiryId: string | undefined = eventData.id ?? attrs.id;
    const status: string | undefined = attrs.status;

    // The account is the one THIS SERVER bound to the inquiry when it created
    // it (lib/compliance/kycBinding) — never the reference-id alone, which the
    // embedded web flow lets any browser choose. An unbound inquiry, or one
    // whose reference disagrees with its binding, changes no account.
    const binding = await resolveKycSession("persona", inquiryId, reference);
    if (!binding.ok) {
      log.warn("persona webhook refused: inquiry not bound to a user", { inquiryId, reason: binding.reason });
      audit("webhook.processed", "system", { provider: "persona", eventType, inquiryId, refused: binding.reason });
      await markProcessed(String(eventId));
      return NextResponse.json({ received: true, refused: binding.reason });
    }
    const userId = binding.userId;

    // The transition goes through the DEDICATED KYC path (it is deliberately
    // unreachable via the identity-field updateUser allow-list).
    const account = await getAccountDurable(userId);
    if (account) {
      if (eventType === "inquiry.completed" || status === "completed") {
        setKycStatus(account.user.id, "verified", 2);
        // One event per user: a redelivered approval is the same fact.
        recordProductEvent({ name: "kyc_completed", eventId: account.user.id, userId: account.user.id, route: "/api/webhooks/persona", metadata: { provider: "persona", tier: 2 } });
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
        // A KYC DEMOTION IS NOT SOMETHING A RETRY MAY DO.
      //
      // Providers deliver at-least-once with no ordering guarantee, so a
      // delayed rejection event can arrive after a later approval — two
      // different event ids, both new, both claimed by webhookGuard, and the
      // second one silently walks a verified user back to unverified. By then
      // they may hold a higher tier cap and have transacted against it.
      // Genuine revocations exist; they are a compliance decision with an
      // audit trail, not a redelivery. See lib/webhookOrdering.ts.
        const current = account.user.kycStatus as KycState;
        if (!kycTransitionAllowed(current, "unverified")) {
          log.warn("refusing webhook KYC demotion", {
            provider: "persona",
            userId: account.user.id,
            from: current,
            inquiryId,
          });
          audit("webhook.processed", account.user.id, {
            provider: "persona",
            event: "inquiry.failed",
            inquiryId,
            refused: "kyc_demotion_requires_review",
          });
          await markProcessed(String(eventId));
          return NextResponse.json({ received: true, refused: "kyc_demotion_requires_review" });
        }
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
    } else {
      log.warn("persona webhook for a bound user with no account", { inquiryId, userId });
    }

    await markProcessed(String(eventId));
    return NextResponse.json({ received: true, inquiryId });
  } catch (e) {
    await markFailed(String(eventId));
    log.error("persona webhook handler failed", { error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
