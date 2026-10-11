import crypto from "crypto";

// ---------------------------------------------------------------------------
// Allium Beam webhook authentication, exactly as documented
// (docs.allium.so/beam/webhook-authentication):
//
//   X-Webhook-Timestamp  unix seconds
//   X-Webhook-Nonce      per-request UUID v4
//   X-Signature-256      "sha256=" + hex(HMAC-SHA256(key, nonce + "." + timestamp + "." + raw_body))
//
// Verified over the RAW body bytes as received (when the sink sets
// enable_http_encoding, that is the zstd-compressed body — decompress only
// after verifying). Constant-time comparison. Timestamps outside a 5-minute
// window either way are rejected. The nonce is then claimed once in Postgres
// by the route (replay protection beyond the window check).
//
// The key is the organization secret referenced by the sink's `hash_key`;
// FurlPay holds the same value in ALLIUM_BEAM_WEBHOOK_SECRET. Unset = every
// delivery is refused (fail closed).
// ---------------------------------------------------------------------------

export const BEAM_MAX_SKEW_S = 300;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BeamAuth =
  | { ok: true; nonce: string; timestamp: number }
  | { ok: false; status: 401 | 503; reason: "not_configured" | "missing_headers" | "bad_nonce" | "bad_timestamp" | "stale" | "bad_signature" };

export function beamSecret(): string {
  return (process.env.ALLIUM_BEAM_WEBHOOK_SECRET ?? "").trim();
}

export function signBeam(secret: string, nonce: string, timestamp: string, body: Buffer | string): string {
  const mac = crypto.createHmac("sha256", secret);
  mac.update(`${nonce}.${timestamp}.`);
  mac.update(body);
  return `sha256=${mac.digest("hex")}`;
}

export function verifyBeam(headers: Headers, rawBody: Buffer, nowMs = Date.now()): BeamAuth {
  const secret = beamSecret();
  if (secret.length < 32) return { ok: false, status: 503, reason: "not_configured" };
  const ts = headers.get("x-webhook-timestamp");
  const nonce = headers.get("x-webhook-nonce");
  const sig = headers.get("x-signature-256");
  if (!ts || !nonce || !sig) return { ok: false, status: 401, reason: "missing_headers" };
  if (!UUID_V4.test(nonce)) return { ok: false, status: 401, reason: "bad_nonce" };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, status: 401, reason: "bad_timestamp" };
  const t = Number(ts);
  if (Math.abs(nowMs / 1000 - t) > BEAM_MAX_SKEW_S) return { ok: false, status: 401, reason: "stale" };
  const expected = Buffer.from(signBeam(secret, nonce, ts, rawBody), "utf8");
  const given = Buffer.from(sig.trim(), "utf8");
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, status: 401, reason: "bad_signature" };
  }
  return { ok: true, nonce: nonce.toLowerCase(), timestamp: t };
}
