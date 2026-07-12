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
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { sendEmail } from "@/lib/email";

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
const RESEND_LIVE = !!process.env.RESEND_API_KEY;

function emailOtpIsLive(): boolean {
  return RESEND_LIVE;
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

const EMAIL_OTP_KEY = (addr: string) => `otp:email:${addr.trim().toLowerCase()}`;
const EMAIL_OTP_TTL_S = 10 * 60;

interface EmailOtpRecord {
  code: string;
  expiresAt: number; // epoch ms
  attempts: number;
}

async function startEmailOtp(to: string): Promise<StartResult> {
  const code = sixDigits();
  await kvSet(
    EMAIL_OTP_KEY(to),
    { code, expiresAt: Date.now() + EMAIL_OTP_TTL_S * 1000, attempts: 0 } satisfies EmailOtpRecord,
    EMAIL_OTP_TTL_S
  );
  const result = await sendEmail({
    to: to.trim(),
    category: "otp",
    subject: `${code} is your FurlPay sign-in code`,
    html: `<p>Your FurlPay sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    text: `Your FurlPay sign-in code is ${code}. It expires in 10 minutes.`,
  });
  if (!result.ok) {
    await kvDel(EMAIL_OTP_KEY(to));
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
  if (rec.attempts >= MAX_ATTEMPTS) {
    await kvDel(key);
    return { approved: false, reason: "too_many_attempts" };
  }
  const remainingTtl = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
  await kvSet(key, { ...rec, attempts: rec.attempts + 1 }, remainingTtl);
  const a = Buffer.from(String(code).padEnd(10));
  const b = Buffer.from(String(rec.code).padEnd(10));
  if (!crypto.timingSafeEqual(a, b)) return { approved: false, reason: "mismatch" };
  await kvDel(key); // single-use
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
