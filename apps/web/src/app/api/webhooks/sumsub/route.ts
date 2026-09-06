import { NextResponse } from "next/server";
import crypto from "crypto";
import { tryBegin, markProcessed, markFailed } from "@/lib/webhookGuard";
import { getAccountDurable, setKycStatus } from "@/lib/store";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { kycTransitionAllowed, type KycState } from "@/lib/webhookOrdering";

// POST /api/webhooks/sumsub — Sumsub applicant review outcomes (KYC/AML).
// Sumsub signs the raw body with the webhook secret; the digest arrives in
// x-payload-digest and the algorithm in x-payload-digest-alg. Verification is
// constant-time. Node runtime for crypto.
export const runtime = "nodejs";

const DIGEST_ALGS: Record<string, string> = {
  HMAC_SHA1_HEX: "sha1",
  HMAC_SHA256_HEX: "sha256",
  HMAC_SHA512_HEX: "sha512",
};

function verifyDigest(payload: string, digest: string | null, alg: string | null, secret: string): boolean {
  if (!digest || !secret) return false;
  const hashAlg = DIGEST_ALGS[alg ?? "HMAC_SHA256_HEX"];
  if (!hashAlg) return false;
  const expected = crypto.createHmac(hashAlg, secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(digest, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const payload = await request.text();
  const secret = process.env.SUMSUB_WEBHOOK_SECRET || "";

  if (
    !verifyDigest(
      payload,
      request.headers.get("x-payload-digest"),
      request.headers.get("x-payload-digest-alg"),
      secret
    )
  ) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = String(event.correlationId ?? event.applicantId ?? "") + ":" + String(event.type ?? "");
  if (!(await tryBegin(eventId))) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    // externalUserId is the FurlPay user id passed when the applicant was
    // created; the KYC transition goes through the dedicated path only.
    const userId: string | undefined = event.externalUserId;
    const account = await getAccountDurable(userId);

    if (account && event.type === "applicantReviewed") {
      const answer: string = event.reviewResult?.reviewAnswer ?? "";
      if (answer === "GREEN") {
        setKycStatus(account.user.id, "verified", 2);
        audit("webhook.processed", account.user.id, {
          provider: "sumsub",
          event: event.type,
          applicantId: event.applicantId,
        });
      } else if (answer === "RED") {
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
            provider: "sumsub",
            userId: account.user.id,
            from: current,
            applicantId: event.applicantId,
          });
          audit("webhook.processed", account.user.id, {
            provider: "sumsub",
            event: event.type,
            applicantId: event.applicantId,
            refused: "kyc_demotion_requires_review",
          });
          await markProcessed(eventId);
          return NextResponse.json({ received: true, refused: "kyc_demotion_requires_review" });
        }
        setKycStatus(account.user.id, "unverified");
        // rejectLabels map to targeted UI correction prompts client-side
        // (e.g. FORGERY, BAD_SELFIE, ID_INVALID).
        audit("webhook.processed", account.user.id, {
          provider: "sumsub",
          event: event.type,
          applicantId: event.applicantId,
          rejectLabels: event.reviewResult?.rejectLabels ?? [],
          rejectType: event.reviewResult?.reviewRejectType,
        });
      }
    } else if (userId && !account) {
      log.warn("sumsub webhook for unknown externalUserId", {
        applicantId: event.applicantId,
        userId,
      });
    }

    await markProcessed(eventId);
    return NextResponse.json({ received: true, applicantId: event.applicantId });
  } catch (e) {
    await markFailed(eventId);
    log.error("sumsub webhook handler failed", { error: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
