// ---------------------------------------------------------------------------
// Phone/email OTP via Twilio Verify. Follows the repo's integration convention:
// runs in MOCK mode with zero credentials (codes are generated in-memory and
// logged to the server console so you can complete the flow offline), and swaps
// to the live Twilio Verify API when INTEGRATION_MODE=live and the credentials
// below are set.
//
// Live docs (2026): https://www.twilio.com/docs/verify/api/verification
//   send : POST /v2/Services/{ServiceSid}/Verifications      { To, Channel }
//   check: POST /v2/Services/{ServiceSid}/VerificationCheck  { To, Code } -> status
// Twilio owns code generation, expiry, per-country routing and rate-limiting,
// which is how "many countries" is supported without any per-country logic here.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { kvGet, kvSet, kvDel, kvSetNx, kvIncr } from "@/lib/kv";
import { sendEmail } from "@/lib/email";
import { otpEmail } from "@/lib/emailTemplates";

export type OtpChannel = "sms" | "call" | "email" | "whatsapp";

const MODE = process.env.INTEGRATION_MODE || "mock";
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

export function otpIsLive(): boolean {
  return MODE === "live" && !!ACCOUNT_SID && !!AUTH_TOKEN && !!SERVICE_SID;
}

// Email OTP has its own live path via Resend (already sending in prod) so an
// unconfigured Twilio doesn't block email sign-in. Codes are stored in Redis
// KV (cross-instance, TTL'd) — never echoed to the caller when live.
// Read at call time (not a module-load snapshot): the live/mock decision must
// reflect the actual current config, not whatever was set when this file first
// imported.
function emailOtpIsLive(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// The mock OTP path generates codes locally and echoes them to the caller — an
// authentication bypass if it ever runs in production. Refuse to fall back to
// mock in production, mirroring the guard in lib/session.ts.
function assertLiveInProduction() {
  if (process.env.NODE_ENV === "production" && !otpIsLive()) {
    throw new Error(
      "OTP is not configured for production. Set INTEGRATION_MODE=live and the TWILIO_* credentials."
    );
  }
}

// ---- Mock store: pending code per recipient, with a 10-minute expiry. --------
interface Pending {
  code: string;
  expiresAt: number;
  attempts: number;
}
const g = globalThis as unknown as { __otp?: Map<string, Pending> };
const pending: Map<string, Pending> = g.__otp ?? (g.__otp = new Map());
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function sixDigits(): string {
  // CSPRNG even though this is the mock path — an OTP is a security value
  // (repo rule: never Math.random for anything security-relevant).
  return String(crypto.randomInt(100000, 1000000));
}

export interface StartResult {
  sent: boolean;
  channel: OtpChannel;
  /** In mock mode only, the code is echoed so the UI/tests can surface it. */
  devCode?: string;
}

// --- Resend-backed email OTP --------------------------------------------------
//
// The code is NEVER stored in recoverable form. We keep only an HMAC of it,
// keyed by the server session secret — so even a full KV dump does not reveal a
// working code (the attacker lacks the HMAC key; a 6-digit code would otherwise
// be brute-forceable in milliseconds from a stored hash). Single-use is enforced
// atomically via kvSetNx (Redis SET NX), so two concurrent submissions of the
// correct code yield exactly ONE success. The attempt counter is an atomic
// kvIncr, so a burst of guesses cannot slip past the cap by racing.

const EMAIL_OTP_KEY = (addr: string) => `otp:email:${normalizeEmail(addr)}`;
const ATTEMPTS_KEY = (addr: string) => `otp:email:attempts:${normalizeEmail(addr)}`;
const CONSUMED_KEY = (addr: string) => `otp:email:consumed:${normalizeEmail(addr)}`;
const COOLDOWN_KEY = (addr: string) => `otp:email:cooldown:${normalizeEmail(addr)}`;
const EMAIL_OTP_TTL_S = 10 * 60;
const RESEND_COOLDOWN_S = 30; // no second send within 30s of the last one

function normalizeEmail(addr: string): string {
  return addr.trim().toLowerCase();
}

/** Pepper for the OTP HMAC. Reuses the session secret (already mandatory and
 *  strong in production — see lib/session.ts). A KV compromise alone cannot
 *  reverse an OTP hash without this. */
const OTP_PEPPER_FALLBACK = "furlpay_dev_otp_pepper_change_me_32bytes";
function otpPepper(): string {
  const secret = process.env.FURLPAY_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FURLPAY_SESSION_SECRET must be set (>= 32 chars) to hash OTPs in production.");
    }
    return OTP_PEPPER_FALLBACK;
  }
  return secret;
}

/** Hash a code, bound to the normalized address so a code minted for A can
 *  never verify for B even if the keys were ever confused. */
function hashOtp(addr: string, code: string): string {
  return crypto
    .createHmac("sha256", otpPepper())
    .update(`${normalizeEmail(addr)}:${code}`)
    .digest("hex");
}

interface EmailOtpRecord {
  hash: string; // HMAC-SHA256(address:code) — never the code itself
  expiresAt: number; // epoch ms
}

async function startEmailOtp(to: string): Promise<StartResult> {
  // Resend cooldown: refuse a second send inside the window. kvSetNx is atomic,
  // so two rapid taps cannot both pass. This is per-address and independent of
  // the route's IP+address rate limit (which is the coarser abuse guard).
  const fresh = await kvSetNx(COOLDOWN_KEY(to), "1", RESEND_COOLDOWN_S);
  if (!fresh) {
    // Generic to the caller — reveals nothing about account existence.
    throw new Error("A code was just sent. Please wait a moment before requesting another.");
  }

  const code = sixDigits();
  // Issuing a new code invalidates the previous one and resets the attempt
  // counter and the single-use guard, so the latest code is the only valid one.
  await kvSet(
    EMAIL_OTP_KEY(to),
    { hash: hashOtp(to, code), expiresAt: Date.now() + EMAIL_OTP_TTL_S * 1000 } satisfies EmailOtpRecord,
    EMAIL_OTP_TTL_S
  );
  await kvDel(ATTEMPTS_KEY(to));
  await kvDel(CONSUMED_KEY(to));

  const tpl = otpEmail(code, Math.round(EMAIL_OTP_TTL_S / 60));
  const result = await sendEmail({
    to: to.trim(),
    category: "otp",
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
  if (!result.ok) {
    // Provider detail goes to the server log only — the client gets a generic
    // message (an attacker mustn't learn suppression/budget/provider state).
    // The raw code is NEVER logged.
    console.error(`[otp:email] send failed: ${result.error}`);
    await kvDel(EMAIL_OTP_KEY(to));
    await kvDel(COOLDOWN_KEY(to)); // a failed send shouldn't lock out a retry
    throw new Error("Could not send the verification email — try again shortly.");
  }
  return { sent: true, channel: "email" };
}

async function checkEmailOtp(to: string, code: string): Promise<CheckResult | null> {
  const key = EMAIL_OTP_KEY(to);
  const rec = await kvGet<EmailOtpRecord>(key);
  if (!rec) return null; // no Resend-path code pending — caller falls through
  if (Date.now() > rec.expiresAt) {
    await kvDel(key);
    return { approved: false, reason: "expired" };
  }

  // Atomic attempt counter: a burst of concurrent guesses cannot each read the
  // same stale count and collectively exceed the cap.
  const remainingTtl = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
  const attempts = await kvIncr(ATTEMPTS_KEY(to), remainingTtl);
  if (attempts > MAX_ATTEMPTS) {
    await kvDel(key);
    return { approved: false, reason: "too_many_attempts" };
  }

  // Timing-safe compare of the HMACs (fixed 64-hex-char length).
  const candidate = Buffer.from(hashOtp(to, String(code)), "hex");
  const expected = Buffer.from(rec.hash, "hex");
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
    return { approved: false, reason: "mismatch" };
  }

  // Atomic single-use: the FIRST caller to claim the consume marker wins; a
  // concurrent second submission of the same correct code loses the race and
  // is rejected. Prevents double-spend of one OTP.
  const won = await kvSetNx(CONSUMED_KEY(to), "1", 60);
  if (!won) return { approved: false, reason: "not_found" };
  await kvDel(key);
  return { approved: true };
}

/** Send an OTP to `to` (E.164 phone, or an email when channel="email"). */
export async function startOtp(to: string, channel: OtpChannel = "sms"): Promise<StartResult> {
  if (otpIsLive()) {
    const twilio = (await import("twilio")).default;
    const client = twilio(ACCOUNT_SID!, AUTH_TOKEN!);
    const v = await client.verify.v2
      .services(SERVICE_SID!)
      .verifications.create({ to, channel });
    return { sent: v.status === "pending", channel };
  }

  if (channel === "email" && emailOtpIsLive()) {
    return startEmailOtp(to);
  }

  assertLiveInProduction();
  const code = sixDigits();
  pending.set(to, { code, expiresAt: Date.now() + TTL_MS, attempts: 0 });
  // Dev affordance: the code never leaves the server except in this log line.
  console.log(`[otp:mock] verification code for ${to} (${channel}): ${code}`);
  return { sent: true, channel, devCode: code };
}

export interface CheckResult {
  approved: boolean;
  reason?: "expired" | "too_many_attempts" | "mismatch" | "not_found";
}

/** Verify a code the user entered for `to`. */
export async function checkOtp(to: string, code: string): Promise<CheckResult> {
  // Resend-path email codes live in KV; if one is pending for this address it
  // is authoritative (checked before Twilio, which never issued it).
  if (to.includes("@")) {
    const emailResult = await checkEmailOtp(to, code);
    if (emailResult) return emailResult;
    // No pending Resend-path code. When email OTP is the live channel (Twilio
    // absent), that's a definitive "request one first" — don't fall through to
    // the mock guard, which would 500.
    if (!otpIsLive() && emailOtpIsLive()) return { approved: false, reason: "not_found" };
  }

  if (otpIsLive()) {
    const twilio = (await import("twilio")).default;
    const client = twilio(ACCOUNT_SID!, AUTH_TOKEN!);
    const check = await client.verify.v2
      .services(SERVICE_SID!)
      .verificationChecks.create({ to, code });
    return { approved: check.status === "approved", reason: check.status === "approved" ? undefined : "mismatch" };
  }

  assertLiveInProduction();
  const rec = pending.get(to);
  if (!rec) return { approved: false, reason: "not_found" };
  if (Date.now() > rec.expiresAt) {
    pending.delete(to);
    return { approved: false, reason: "expired" };
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    pending.delete(to);
    return { approved: false, reason: "too_many_attempts" };
  }
  rec.attempts += 1;
  if (rec.code !== code) return { approved: false, reason: "mismatch" };
  pending.delete(to); // single-use
  return { approved: true };
}
