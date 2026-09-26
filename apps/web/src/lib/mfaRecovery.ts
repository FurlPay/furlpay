import { createHash, randomBytes, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// MFA recovery codes.
//
// WHY: with TOTP as the only second factor, a lost or wiped phone means a
// permanently locked account. MFA exists to stop an attacker getting in; without
// a recovery path it just as reliably stops the OWNER getting in, and the usual
// remedy — a human support agent turning MFA off on request — is a social
// engineering hole far larger than the one MFA closed.
//
// DESIGN:
//  - 10 codes, generated together, shown to the owner exactly once.
//  - Stored as SHA-256 hashes. A recovery code IS a second factor, so the stored
//    record must not contain one; a database read must not yield working codes.
//  - Single use: consuming a code deletes its hash, so a code that leaks after
//    use is worthless and a replay cannot succeed.
//  - Compared in constant time, because a byte-by-byte early return leaks how
//    much of a guess was correct.
//
// SHA-256 rather than a slow KDF (bcrypt/scrypt/argon2) is deliberate and worth
// stating: these are not passwords. A code is 80 bits of CSPRNG output, so there
// is no dictionary to run and brute force is hopeless regardless of hash speed.
// A slow KDF here would only add latency to a recovery flow that is already rate
// limited. Human-chosen secrets would need the opposite decision.
// ---------------------------------------------------------------------------

/** How many codes a user gets. Enough to survive a few losses, few enough to write down. */
export const RECOVERY_CODE_COUNT = 10;

/** Crockford-style base32 without I/L/O/U — no character pairs a human can confuse. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** `xxxxx-xxxxx` — grouped because people transcribe these by hand. */
function formatCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

/**
 * One recovery code: 10 characters from a 30-symbol alphabet ≈ 49 bits.
 *
 * Uses rejection sampling rather than `% ALPHABET.length`. The modulo is the
 * classic bias bug: 256 is not divisible by 30, so the first 16 symbols would be
 * drawn slightly more often than the rest. The loss is small but it is a real
 * reduction in entropy, and the fix costs nothing.
 */
function generateCode(): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte >= limit) continue; // reject, do not fold
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === 10) break;
    }
  }
  return formatCode(out);
}

/** Normalise before hashing or comparing: case and dashes are presentation only. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(`furlpay:mfa-recovery:${normalizeCode(code)}`).digest("hex");
}

/**
 * Mint a fresh set of codes.
 *
 * Returns the PLAINTEXT codes (to show the owner once) and the HASHES (to
 * store). The caller must never persist the plaintext.
 */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const code = generateCode();
    if (!codes.includes(code)) codes.push(code);
  }
  return { codes, hashes: codes.map(hashCode) };
}

/**
 * Check a submitted code against stored hashes.
 *
 * Returns the remaining hashes with the used one removed, so the caller persists
 * a set that can no longer accept that code. `ok: false` leaves the set
 * untouched.
 *
 * Every candidate is compared even after a match is found — returning early on
 * the first hit would make the response time depend on the code's position in
 * the list.
 */
export function consumeRecoveryCode(
  submitted: string,
  storedHashes: readonly string[] | undefined
): { ok: boolean; remaining: string[] } {
  const stored = storedHashes ?? [];
  const candidate = Buffer.from(hashCode(submitted), "utf8");

  let matchedIndex = -1;
  for (let i = 0; i < stored.length; i++) {
    const known = Buffer.from(stored[i], "utf8");
    // timingSafeEqual throws on a length mismatch, which itself leaks; guard it.
    const same = known.length === candidate.length && timingSafeEqual(known, candidate);
    if (same && matchedIndex === -1) matchedIndex = i;
  }

  if (matchedIndex === -1) return { ok: false, remaining: [...stored] };
  return { ok: true, remaining: stored.filter((_, i) => i !== matchedIndex) };
}
