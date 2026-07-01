import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkOtp } from "@/lib/auth/otp";
import { db, updateUser } from "@/lib/store";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

const Body = z.object({
  to: z.string().min(4),
  code: z.string().min(4).max(10),
  channel: z.enum(["sms", "call", "email", "whatsapp"]).default("sms"),
  // When true, a successful check also issues a session (phone-number sign-in).
  // When false (signup step), it only marks the phone verified.
  login: z.boolean().default(true),
});

// POST /api/auth/otp/check — verify a code. On success, mark the phone verified
// and (unless login=false) issue a signed session.
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { to, code, channel, login } = parsed.data;

  const result = await checkOtp(to, code);
  if (!result.approved) {
    const msg =
      result.reason === "expired" ? "Code expired — request a new one."
      : result.reason === "too_many_attempts" ? "Too many attempts — request a new code."
      : result.reason === "not_found" ? "No pending code — request one first."
      : "Incorrect code.";
    return NextResponse.json({ verified: false, reason: result.reason, error: msg }, { status: 401 });
  }

  if (channel === "email") {
    updateUser({ email: to });
  } else {
    updateUser({ phone: to, phoneVerified: true, authProvider: "phone" });
  }

  const res = NextResponse.json({ verified: true });
  if (login) {
    const token = await signSession({ sub: db.user.id, safe: db.user.safeAddress });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }
  return res;
}
