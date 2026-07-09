import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Signed one-click account-lock links for transactional emails ("Don't
// recognize this? Lock your account"). The victim of an account takeover may
// not be able to log in, so the link must work WITHOUT a session: the URL
// carries an HMAC over (userId, expiry) keyed by FURLPAY_SESSION_SECRET.
// Locking is safe to expose this way — it only ever restricts the account
// (authz.ts refuses locked accounts); unlocking still requires a full login.
// ---------------------------------------------------------------------------

const SECRET = process.env.FURLPAY_SESSION_SECRET || "";
const ORIGIN = process.env.FURLPAY_ORIGIN || "https://furlpay.com";

const sig = (userId: string, expiry: number): string =>
  createHmac("sha256", SECRET).update(`lock:${userId}:${expiry}`).digest("base64url");

/** Absolute lock URL for email templates. Valid for `ttlDays` (default 30 —
 *  receipts get read late). Returns null when no signing secret is set. */
export function lockLinkFor(userId: string, ttlDays = 30): string | null {
  if (!SECRET) return null;
  const expiry = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  return `${ORIGIN}/api/security/lock?u=${encodeURIComponent(userId)}&e=${expiry}&t=${sig(userId, expiry)}`;
}

export function verifyLockToken(userId: string, expiry: number, token: string): boolean {
  if (!SECRET || !userId || !Number.isFinite(expiry)) return false;
  if (expiry * 1000 < Date.now()) return false;
  const expected = Buffer.from(sig(userId, expiry));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
