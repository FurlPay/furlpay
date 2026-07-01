import crypto from "crypto";

// ---------------------------------------------------------------------------
// RFC 6238 Time-based One-Time Passwords (TOTP) + RFC 4648 base32.
// Used for OATH-TOTP authenticator-app MFA (Google Authenticator, Authy, etc.)
// as the backup factor when a FIDO2 hardware key is not present.
// Dependency-free (Node crypto only).
// ---------------------------------------------------------------------------

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/,"").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new base32 TOTP secret (20 random bytes by default). */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

export interface TotpOptions {
  digits?: number;
  period?: number;
  time?: number; // seconds since epoch (defaults to now)
  algorithm?: "sha1" | "sha256" | "sha512";
}

/** Compute the TOTP code for a base32 secret. */
export function totp(secret: string, opts: TotpOptions = {}): string {
  const { digits = 6, period = 30, algorithm = "sha1" } = opts;
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / period);

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm, base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Verify a token, allowing +/- `window` steps for clock drift. */
export function verifyTotp(secret: string, token: string, opts: TotpOptions & { window?: number } = {}): boolean {
  const { window = 1, period = 30 } = opts;
  const now = opts.time ?? Math.floor(Date.now() / 1000);
  const clean = (token || "").trim();
  for (let i = -window; i <= window; i++) {
    const candidate = totp(secret, { ...opts, time: now + i * period });
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean.padStart(candidate.length, "0")))) {
      return true;
    }
  }
  return false;
}

/** Build an otpauth:// URI for QR-code enrollment. */
export function otpauthUrl(secret: string, account: string, issuer = "Furlpay"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
