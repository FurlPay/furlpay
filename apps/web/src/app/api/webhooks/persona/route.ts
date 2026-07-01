import { NextResponse } from "next/server";
import { verifyPersonaSignature } from "@/lib/kyc/persona";
import { markProcessed } from "@/lib/webhookGuard";
import { db, updateUser } from "@/lib/store";

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
  if (!markProcessed(String(eventId))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  const userId: string | undefined = attrs.referenceId ?? attrs["reference-id"] ?? eventData.referenceId;
  const inquiryId: string | undefined = eventData.id ?? attrs.id;
  const status: string | undefined = attrs.status;

  if (eventType === "inquiry.completed" || status === "completed") {
    // UPDATE furlpay_database SET kyc_status = 'verified' WHERE user_id = userId
    if (userId && userId === db.user.id) updateUser({ kycStatus: "verified", kycTier: 2 });
  } else if (eventType === "inquiry.failed" || status === "failed") {
    if (userId && userId === db.user.id) updateUser({ kycStatus: "unverified" });
  }

  return NextResponse.json({ received: true, inquiryId });
}
