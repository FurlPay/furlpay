import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// POST /api/auth/webauthn — Passkey (WebAuthn) challenge + registration/login.
// body: { action: "register" | "login", credential?: {...} }
// This models the server side of a passkey ceremony (Turnkey / Dynamic.xyz).
export async function POST(req: NextRequest) {
  const { action, credential } = await req.json();

  if (action === "register" || action === "login") {
    if (!credential) {
      // Phase 1: hand the client a challenge to sign with the device enclave.
      const challenge = crypto.randomBytes(32).toString("base64url");
      return NextResponse.json({
        challenge,
        rp: { id: "furlpay.app", name: "Furlpay" },
        timeout: 60000,
        userVerification: "required",
      });
    }
    // Phase 2: verify the signed assertion (mocked) and mint a session token.
    // On success a Safe smart account is deployed / resolved for the passkey.
    const token = crypto.randomBytes(24).toString("base64url");
    const res = NextResponse.json({
      success: true,
      token,
      safeAddress: "0x7A9f" + crypto.randomBytes(9).toString("hex") + "c31E",
      newAccount: action === "register",
    });
    // HttpOnly session cookie consumed by middleware to gate the app.
    res.cookies.set("furlpay_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
