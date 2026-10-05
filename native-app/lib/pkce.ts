import * as Crypto from "expo-crypto";

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256) for the native Apple sign-in handoff (audit P1-2).
//
// The server's one-time code comes back on a furlpay:// deep link, which any
// app on an Android device can also claim. The verifier generated here never
// leaves this process until the TLS exchange at /api/auth/native/exchange, so a
// code captured by another app cannot be redeemed. The challenge travels as
// the state suffix AND as Apple's nonce, which binds the Apple id_token to this
// sign-in attempt (app/api/auth/apple/callback on the server).
// ---------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 base64url, no padding. No Buffer/btoa dependency (Hermes). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** base64 (standard, padded) → base64url without padding. */
export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  /** 43-char RFC 7636 verifier from 32 CSPRNG bytes. Keep in memory only. */
  verifier: string;
  /** base64url(SHA-256(verifier)). Safe to send anywhere. */
  challenge: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64UrlEncode(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64ToBase64Url(digest) };
}
