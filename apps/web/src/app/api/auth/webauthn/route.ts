import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/store";
import { RP_ID, RP_NAME } from "@/lib/webauthn";
import { setSessionCookieForRequest, signSession } from "@/lib/session";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/auth/webauthn — sandbox/demo passkey login that issues a real signed
// JWT session. For a full FIDO2 ceremony (real attestation/assertion), use the
// /api/auth/passkey/* routes backed by @simplewebauthn/server.
// body: { action: "register" | "login", credential?: {...} }
export async function POST(req: NextRequest) {
  // Unauthenticated WebAuthn surface — throttle credential guessing.
  const limited = await rateLimitOr429(req, "auth.webauthn", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { action, credential } = await req.json();

  if (action === "register" || action === "login") {
    if (!credential) {
      // Phase 1: hand the client a challenge to sign with the device enclave.
      const challenge = crypto.randomBytes(32).toString("base64url");
      return NextResponse.json({
        challenge,
        // Resolved from server config (env / Vercel), not the request Host header.
        rp: { id: RP_ID, name: RP_NAME },
        timeout: 60000,
        userVerification: "required",
      });
    }
    // Phase 2 issues a session WITHOUT cryptographically verifying the credential
    // — it exists only for local sandbox demos. Disable it outside development so
    // it can never be used as an authentication bypass; real ceremonies go through
    // /api/auth/passkey/* (backed by @simplewebauthn/server).
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Demo passkey route is disabled in production. Use /api/auth/passkey/*." },
        { status: 404 }
      );
    }
    const demo = db;
    if (!demo) {
      return NextResponse.json({ error: "Demo passkey route unavailable" }, { status: 404 });
    }
    // Phase 2: issue a signed session JWT (jose, HS256).
    const token = await signSession({ sub: demo.user.id, safe: demo.user.safeAddress });
    const res = NextResponse.json({
      success: true,
      safeAddress: demo.user.safeAddress,
      newAccount: action === "register",
    });
    setSessionCookieForRequest(req, res, token);
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
