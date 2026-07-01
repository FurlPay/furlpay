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

export type OtpChannel = "sms" | "call" | "email" | "whatsapp";

const MODE = process.env.INTEGRATION_MODE || "mock";
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

export function otpIsLive(): boolean {
  return MODE === "live" && !!ACCOUNT_SID && !!AUTH_TOKEN && !!SERVICE_SID;
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
  return String(Math.floor(100000 + Math.random() * 900000));
}

export interface StartResult {
  sent: boolean;
  channel: OtpChannel;
  /** In mock mode only, the code is echoed so the UI/tests can surface it. */
  devCode?: string;
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
  if (otpIsLive()) {
    const twilio = (await import("twilio")).default;
    const client = twilio(ACCOUNT_SID!, AUTH_TOKEN!);
    const check = await client.verify.v2
      .services(SERVICE_SID!)
      .verificationChecks.create({ to, code });
    return { approved: check.status === "approved", reason: check.status === "approved" ? undefined : "mismatch" };
  }

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
