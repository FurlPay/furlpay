import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// The HMAC secret that binds x402 / MPP quotes to a resource, price and expiry.
//
// THERE IS NO DEFAULT IN PRODUCTION. Both lib/x402.ts and lib/mpp.ts used to
// fall back to a hard-coded "dev quote secret … change me" string when
// X402_QUOTE_SECRET was unset — and on furlpay.com it WAS unset (checked 6 Oct
// 2026), so every quote binding was signed with a key published in this
// repository. Anyone could have minted a valid binding. A default secret is a
// published secret; @furlpay/gateway refuses one for the same reason.
//
//   production   X402_QUOTE_SECRET must be set, >= 32 chars, else
//                QuoteSecretMissingError — never a fallback.
//   dev / test   the env value if set, otherwise a RANDOM per-process secret:
//                quotes still work locally, and nothing predictable is used.
//
// The value is never logged, returned, or included in an error message.
// ---------------------------------------------------------------------------

export const MIN_QUOTE_SECRET_LENGTH = 32;

export class QuoteSecretMissingError extends Error {
  constructor() {
    super(
      `X402_QUOTE_SECRET is not configured (required in production, at least ${MIN_QUOTE_SECRET_LENGTH} characters). ` +
        "x402 / MPP quotes cannot be issued or verified until it is set."
    );
    this.name = "QuoteSecretMissingError";
  }
}

let devSecret: Buffer | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when quotes can be signed in this environment. */
export function quoteSecretConfigured(): boolean {
  const v = process.env.X402_QUOTE_SECRET;
  if (isProduction()) return typeof v === "string" && v.length >= MIN_QUOTE_SECRET_LENGTH;
  return true;
}

/** The quote-binding secret. Throws in production when it is not configured. */
export function quoteSecret(): Buffer {
  const v = process.env.X402_QUOTE_SECRET;
  if (isProduction()) {
    if (!v || v.length < MIN_QUOTE_SECRET_LENGTH) throw new QuoteSecretMissingError();
    return Buffer.from(v);
  }
  if (v) return Buffer.from(v);
  devSecret ??= randomBytes(32);
  return devSecret;
}

/** The structured answer a quote route gives when the secret is missing:
 *  503, retryable once configured, and nothing about the value. */
export function x402NotConfigured(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "x402_not_configured",
        message: "Paid quotes are temporarily unavailable on this deployment.",
      },
    },
    { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } }
  );
}

/** Test hook: forget the per-process development secret. */
export function __resetDevQuoteSecret(): void {
  devSecret = null;
}
