import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/store";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// POST /api/auth/webauthn — sandbox/demo passkey login that issues a real signed
// JWT session. For a full FIDO2 ceremony (real attestation/assertion), use the
// /api/auth/passkey/* routes backed by @simplewebauthn/server.
// body: { action: "register" | "login", credential?: {...} }
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
    // Phase 2: issue a signed session JWT (jose, HS256).
    const token = await signSession({ sub: db.user.id, safe: db.user.safeAddress });
    const res = NextResponse.json({
      success: true,
      safeAddress: db.user.safeAddress,
      newAccount: action === "register",
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
