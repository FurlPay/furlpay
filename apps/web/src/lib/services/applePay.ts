import { randomUUID } from "crypto";
import { isLive } from "@/lib/integrations";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Apple Pay top-up capture.
//
// Apple Pay hands the device an encrypted PKPaymentToken. The ciphertext is
// opened with a merchant private key that lives with the payment processor and
// never on a device or in this process — so this module does NOT decrypt it.
// Its job is to hand the opaque blob to the processor and report what the
// processor actually captured.
//
// Two properties matter more than anything else here:
//
//   1. The captured amount is authoritative, never the client's. The iOS app
//      sends `amountUsd` because that is what the payment sheet displayed, but
//      a client that lies about it must not be able to mint balance. Callers
//      credit `capture.amountUsd`, and `verifyAmount()` rejects a mismatch
//      outside a cent of rounding.
//
//   2. A mock capture must never look like a real one to the caller. In mock
//      mode `provider` is "mock" and `processorRef` is absent, so nothing
//      downstream can mistake a simulated capture for settled money. The route
//      additionally refuses to run at all in production without live config
//      (see liveOr503) — this module is not the only guard, but it does not
//      pretend either.
// ---------------------------------------------------------------------------

export type ApplePayProvider = "mock" | "stripe";

export interface ApplePayCapture {
  /** Which path actually ran. "mock" means no money moved. */
  provider: ApplePayProvider;
  /** What the processor captured, in USD. Authoritative over the client. */
  amountUsd: number;
  /** The processor's own reference. Absent in mock mode. */
  processorRef?: string;
  /** Card network as reported by the client, for the receipt line only. */
  network?: string;
  /** Masked descriptor, e.g. "•••• 4242". Never a full PAN. */
  displayName?: string;
}

export class ApplePayCaptureError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplePayCaptureError";
  }
}

/** Apple's token is base64 of a JSON envelope. Reject an obviously malformed
 *  blob before it reaches the processor — that is a client bug, and finding it
 *  out at the processor costs a round trip and an alert.
 *
 *  This is a shape check, not a validity check. The processor's merchant key
 *  is the only thing that can say whether a token is genuine, so anything that
 *  looks plausible is forwarded rather than guessed at here. */
function assertWellFormedToken(paymentData: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(paymentData)) {
    throw new ApplePayCaptureError("invalid_token", "paymentData is not valid base64");
  }
  // Buffer.from is lenient and silently drops junk, so the regex above is what
  // actually rejects non-base64; this only measures the payload.
  const decoded = Buffer.from(paymentData, "base64");
  if (decoded.length < 64) {
    throw new ApplePayCaptureError("invalid_token", "paymentData is too short to be a payment token");
  }
}

/**
 * Hand the opaque token to the processor and return what it captured.
 *
 * In mock mode this simulates a capture without contacting anyone. In live
 * mode it requires a processor to be configured; there is no third state where
 * a live deployment quietly falls back to a fabricated capture.
 */
export async function captureApplePayToken(input: {
  paymentData: string;
  amountUsd: number;
  network?: string | null;
  displayName?: string | null;
  idempotencyKey: string;
}): Promise<ApplePayCapture> {
  assertWellFormedToken(input.paymentData);

  const network = input.network ?? undefined;
  const displayName = input.displayName ?? undefined;

  if (!isLive()) {
    // No network call, no fabricated processor reference. The caller can tell
    // this apart from a real capture by `provider`.
    log.info("applePay.capture.mock", {
      amountUsd: input.amountUsd,
      network,
      idempotencyKey: input.idempotencyKey,
    });
    return { provider: "mock", amountUsd: input.amountUsd, network, displayName };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const merchantId = process.env.APPLE_PAY_MERCHANT_ID?.trim();
  if (!secretKey || !merchantId) {
    // Live deployment, no processor. Fail closed rather than credit.
    throw new ApplePayCaptureError(
      "processor_not_configured",
      "Apple Pay capture requires STRIPE_SECRET_KEY and APPLE_PAY_MERCHANT_ID"
    );
  }

  // Live capture is intentionally not implemented against a processor account
  // that does not exist yet. Throwing here is the honest outcome: it surfaces
  // as a 502 the client can retry, and it cannot be mistaken for a credit.
  // Wiring this up needs a Stripe PaymentIntent created with
  // `payment_method_data[type]=card` and the decrypted token forwarded as an
  // Apple Pay `payment_method_data[card][token]`, using `idempotencyKey` as
  // the Stripe idempotency key so a retry cannot double-charge.
  throw new ApplePayCaptureError(
    "processor_not_implemented",
    "Live Apple Pay capture is not wired to a processor on this deployment"
  );
}

/**
 * Guard against a client that authorises one amount and claims another.
 * A cent of tolerance absorbs float representation, nothing more.
 */
export function verifyAmount(claimedUsd: number, capturedUsd: number): boolean {
  return Math.abs(claimedUsd - capturedUsd) < 0.01;
}

/** Transaction ids are security-relevant: they appear in receipts and are used
 *  as lookup keys, so they come from the CSPRNG, never Math.random(). */
export function newTopUpId(): string {
  return `aptu_${randomUUID()}`;
}
