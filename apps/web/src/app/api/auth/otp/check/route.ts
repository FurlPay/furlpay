import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkOtp } from "@/lib/auth/otp";
import { findOrCreateUserByIdentity, updateUser } from "@/lib/store";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";

const Body = z.object({
  to: z.string().min(4),
  code: z.string().min(4).max(10),
  channel: z.enum(["sms", "call", "email", "whatsapp"]).default("sms"),
  // When true, a successful check also issues a session (phone-number sign-in).
  // When false (signup step), it only marks the phone verified.
  login: z.boolean().default(true),
});

// POST /api/auth/otp/check — verify a code. On success, resolve (or create)
// the account for the now-VERIFIED phone/email and issue a session bound to
// that user (unless login=false).
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { to, code, channel, login } = parsed.data;

  // Brute-force guard on top of checkOtp's own attempt counter: key by IP AND
  // destination so an attacker can't spray codes across identifiers.
  const limited = rateLimitOr429(req, "otp.check", { limit: 10, windowMs: 5 * 60_000 }, to);
  if (limited) return limited;

  const result = await checkOtp(to, code);
  if (!result.approved) {
    const msg =
      result.reason === "expired" ? "Code expired — request a new one."
      : result.reason === "too_many_attempts" ? "Too many attempts — request a new code."
      : result.reason === "not_found" ? "No pending code — request one first."
      : "Incorrect code.";
    return NextResponse.json({ verified: false, reason: result.reason, error: msg }, { status: 401 });
  }

  const { account, created } = findOrCreateUserByIdentity(
    channel === "email" ? { email: to } : { phone: to, authProvider: "phone" }
  );
  if (channel === "email") {
    updateUser(account.user.id, { email: to });
  } else {
    updateUser(account.user.id, { phone: to, phoneVerified: true, authProvider: "phone" });
  }

  const res = NextResponse.json({ verified: true });
  if (login) {
    const token = await signSession({
      sub: account.user.id,
      safe: account.user.safeAddress,
      roles: account.user.roles,
    });
    setSessionCookie(res, token);
    audit(created ? "auth.signup" : "auth.login", account.user.id, { provider: `otp:${channel}` });
  }
  return res;
}
