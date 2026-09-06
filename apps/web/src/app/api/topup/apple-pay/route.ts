import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { liveOr503 } from "@/lib/integrations";
import { ApplePayTopUpSchema } from "@/lib/schemas";
import { creditAccount } from "@/lib/services/account";
import {
  ApplePayCaptureError,
  captureApplePayToken,
  newTopUpId,
  verifyAmount,
} from "@/lib/services/applePay";
import { log } from "@/lib/log";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/topup/apple-pay — capture an authorised Apple Pay token and credit
// the user's FurlPay balance.
//
// The counterpart is `submitApplePayTopUp` in
// ios/FurlPayGuardian/Shared/Network/FurlPayAPIClient.swift. The wire shape is
// that client's `ApplePayTopUpRequest`, so the schema follows it rather than
// the other way round.
//
// Ordering here is deliberate. The user is resolved first (an anonymous caller
// gets 401 without us touching a token), then rate limited per user rather than
// per IP (this moves money, and an IP bucket is shared by everyone behind a
// carrier NAT), then deduped on the client's key BEFORE the body is parsed, so
// a retried POST can never capture twice.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.claims.sub;

  // 10/min per user. Apple Pay requires a Face ID authorisation per attempt,
  // so a legitimate user cannot approach this; a scripted client can.
  const limited = await rateLimitOr429(
    req,
    "topup.applePay",
    { limit: 10, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  // Production without live processor config must not simulate a capture.
  const unavailable = liveOr503("Apple Pay top-up");
  if (unavailable) return unavailable;

  // Dedupe on the header the client also sends as a body field. Claimed before
  // parsing so a retry short-circuits without re-reading a 4KB token.
  return withIdempotency(req.headers.get("idempotency-key"), "topup.applePay", async () => {
    const body = await validateBody(req, ApplePayTopUpSchema);
    if (body instanceof NextResponse) return body;

    let capture;
    try {
      capture = await captureApplePayToken({
        paymentData: body.paymentData,
        amountUsd: body.amountUsd,
        network: body.network,
        displayName: body.displayName,
        idempotencyKey: body.idempotencyKey,
      });
    } catch (e) {
      if (e instanceof ApplePayCaptureError) {
        // The token never reaches the log — only the failure code does.
        log.warn("applePay.capture.failed", { userId, code: e.code });
        audit("topup.applePay.failed", userId, { code: e.code, amountUsd: body.amountUsd });
        const status = e.code === "invalid_token" ? 400 : 502;
        return NextResponse.json({ error: e.code, message: e.message }, { status });
      }
      throw e;
    }

    // The processor's figure wins. A client claiming more than it authorised
    // gets nothing, and the discrepancy is audited rather than silently clamped.
    if (!verifyAmount(body.amountUsd, capture.amountUsd)) {
      log.error("applePay.amount_mismatch", {
        userId,
        claimedUsd: body.amountUsd,
        capturedUsd: capture.amountUsd,
      });
      audit("topup.applePay.amount_mismatch", userId, {
        claimedUsd: body.amountUsd,
        capturedUsd: capture.amountUsd,
      });
      return NextResponse.json(
        { error: "amount_mismatch", message: "Captured amount does not match the authorised amount" },
        { status: 409 }
      );
    }

    const transactionId = newTopUpId();
    const descriptor = capture.displayName
      ? `Apple Pay · ${capture.displayName}`
      : "Apple Pay top-up";

    const credit = await creditAccount(userId, capture.amountUsd, "Apple Pay top-up", descriptor);
    if (!credit.ok) {
      // The ledger refused, so the balance did not move. If a real capture
      // already happened this needs a refund, which is why it is an error-level
      // event and not a warning.
      log.error("applePay.credit_failed", {
        userId,
        transactionId,
        provider: capture.provider,
        processorRef: capture.processorRef,
        error: credit.error,
      });
      audit("topup.applePay.credit_failed", userId, {
        transactionId,
        provider: capture.provider,
        error: credit.error,
      });
      return NextResponse.json(
        { error: "credit_failed", message: "Payment captured but the balance could not be credited" },
        { status: 500 }
      );
    }

    log.info("applePay.topup.settled", {
      userId,
      transactionId,
      provider: capture.provider,
      amountUsd: capture.amountUsd,
    });
    audit("topup.applePay.settled", userId, {
      transactionId,
      provider: capture.provider,
      amountUsd: capture.amountUsd,
    });

    // Deliberately narrow: no token, no processor reference, no raw balance
    // internals. `simulated` is present so a client can never mistake a mock
    // credit for settled money.
    return NextResponse.json({
      success: true,
      transactionId,
      amount: capture.amountUsd,
      balanceUsd: credit.balanceUsd,
      ...(capture.provider === "mock" ? { simulated: true } : {}),
    });
  }, { principal: userId });
}
