import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSecret, otpauthUrl, verifyTotp } from "@furlpay/security";
import { requireUser } from "@/lib/authz";
import { persistAccount } from "@/lib/store";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

const MfaBody = z.object({
  action: z.enum(["enroll", "verify", "disable"]),
  code: z.string().trim().min(6).max(10).optional(),
});

// TOTP MFA management for the AUTHENTICATED user.
//
// This route MUST resolve the acting user from the session and operate on THEIR
// account — earlier it was unauthenticated and always touched the seeded demo
// account (`db`), which meant (a) MFA was non-functional for real users and
// (b) any anonymous caller could enroll/enable/disable TOTP on the shared demo
// account and read back an enrollment secret. Per the repo security rules,
// u.security.totpSecret is only ever written here, and the secret is returned
// exactly once — to the authenticated owner — for QR enrollment.

// GET /api/security/mfa — MFA status (never returns the secret).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const sec = auth.account.user.security;
  return NextResponse.json({
    totpEnabled: sec.totpEnabled,
    hardwareKeys: sec.hardwareKeys,
  });
}

// POST /api/security/mfa — enroll / verify / disable TOTP.
// body: { action: "enroll" | "verify" | "disable", code? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // MFA enroll/verify is security-sensitive and brute-forceable on verify.
  const limited = await rateLimitOr429(req, "security.mfa", { limit: 10, windowMs: 5 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, MfaBody);
  if (body instanceof NextResponse) return body;
  const user = auth.account.user;
  const sec = user.security;

  if (body.action === "enroll") {
    // Generate a pending secret and return the otpauth URI for QR enrollment.
    // Returned once, to the authenticated owner only.
    const secret = generateSecret();
    sec.totpSecret = secret;
    sec.totpEnabled = false;
    await persistAccount(user.id);
    audit("auth.mfa_enrolled", user.id, {});
    return NextResponse.json({
      secret,
      otpauthUrl: otpauthUrl(secret, user.email),
    });
  }

  if (body.action === "verify") {
    if (!body.code) return NextResponse.json({ error: "code required" }, { status: 400 });
    const ok = verifyTotp(sec.totpSecret, body.code);
    if (!ok) {
      audit("auth.mfa_failed", user.id, {});
      return NextResponse.json({ error: "Invalid code" }, { status: 401 });
    }
    sec.totpEnabled = true;
    await persistAccount(user.id);
    audit("auth.mfa_enabled", user.id, {});
    return NextResponse.json({ success: true, totpEnabled: true });
  }

  if (body.action === "disable") {
    sec.totpEnabled = false;
    await persistAccount(user.id);
    audit("auth.mfa_disabled", user.id, {});
    return NextResponse.json({ success: true, totpEnabled: false });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
