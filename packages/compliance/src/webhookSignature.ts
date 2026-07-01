import crypto from "crypto";

// ---------------------------------------------------------------------------
// Webhook signature signing/verification (Developer Ecosystem Doc 1 §2).
// Furlpay signs webhook payloads so merchants can verify authenticity, exactly
// like Stripe's `constructEvent`. Scheme: HMAC-SHA256 over `${timestamp}.${body}`.
// Header format:  furlpay-signature: t=<unix>,v1=<hex hmac>
// ---------------------------------------------------------------------------

const TOLERANCE_SECONDS = 300; // reject replayed events older than 5 min

export function signPayload(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signed = `${timestamp}.${body}`;
  const v1 = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function parseHeader(header: string): { t: number; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return null;
  return { t: Number(parts.t), v1: parts.v1 };
}

export interface FurlpayEvent<T = unknown> {
  id: string;
  type: string;
  created: number;
  data: T;
}

/**
 * Verify a signature header and return the parsed event.
 * Throws if the signature is missing, malformed, expired, or does not match.
 */
export function constructEvent<T = unknown>(
  body: string,
  signatureHeader: string | null | undefined,
  secret: string
): FurlpayEvent<T> {
  if (!signatureHeader) throw new Error("Missing furlpay-signature header");
  const parsed = parseHeader(signatureHeader);
  if (!parsed) throw new Error("Malformed furlpay-signature header");

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > TOLERANCE_SECONDS) {
    throw new Error("Signature timestamp outside tolerance (possible replay)");
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.t}.${body}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parsed.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Signature verification failed");
  }

  return JSON.parse(body) as FurlpayEvent<T>;
}
