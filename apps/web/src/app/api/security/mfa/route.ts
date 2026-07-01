import { NextRequest, NextResponse } from "next/server";
import { generateSecret, otpauthUrl, verifyTotp } from "@furlpay/security";
import { db } from "@/lib/store";

// GET /api/security/mfa — MFA status (never returns the secret).
export async function GET() {
  const sec = db.user.security;
  return NextResponse.json({
    totpEnabled: sec.totpEnabled,
    hardwareKeys: sec.hardwareKeys,
  });
}

// POST /api/security/mfa — enroll / verify / disable TOTP.
// body: { action: "enroll" | "verify" | "disable", code? }
export async function POST(req: NextRequest) {
  const { action, code } = await req.json().catch(() => ({}));
  const sec = db.user.security;

  if (action === "enroll") {
    // Generate a pending secret and return the otpauth URI for QR enrollment.
    const secret = generateSecret();
    sec.totpSecret = secret;
    sec.totpEnabled = false;
    return NextResponse.json({
      secret,
      otpauthUrl: otpauthUrl(secret, db.user.email),
    });
  }

  if (action === "verify") {
    if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
    const ok = verifyTotp(sec.totpSecret, code);
    if (!ok) return NextResponse.json({ error: "Invalid code" }, { status: 401 });
    sec.totpEnabled = true;
    return NextResponse.json({ success: true, totpEnabled: true });
  }

  if (action === "disable") {
    sec.totpEnabled = false;
    return NextResponse.json({ success: true, totpEnabled: false });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
