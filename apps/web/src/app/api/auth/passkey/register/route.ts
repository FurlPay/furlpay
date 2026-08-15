import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/store";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  RP_NAME,
  addCredential,
  deviceLabelFromUA,
  getCredentials,
  setChallenge,
  takeChallenge,
} from "@/lib/webauthn";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/auth/passkey/register — real WebAuthn registration options.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.passkey.register.options", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const user = db.user;
  const existing = await getCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    attestationType: "none",
    // Prefer the built-in fingerprint/biometric sensor (platform authenticator)
    // and require user verification so the credential is gated on the biometric.
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: existing.map((c) => ({ id: c.id })),
  });
  await setChallenge(user.id, options.challenge);
  return NextResponse.json(options);
}

// POST /api/auth/passkey/register — verify attestation, store the credential,
// and issue a signed session on success.
export async function POST(req: NextRequest) {
  // Credential registration: unauthenticated and CPU-bound (attestation
  // verification), so tighter than the 150/min baseline.
  const limited = await rateLimitOr429(req, "auth.passkey.register", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const user = db.user;
  const body = await req.json();
  const expectedChallenge = await takeChallenge(user.id);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No pending challenge" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      // EXPECTED_ORIGINS includes the Android app's `android:apk-key-hash:` origin
      // when FURLPAY_ANDROID_CERT_SHA256 is set — a native caller never presents
      // https://furlpay.com. See lib/webauthn.ts.
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: EXPECTED_RPIDS,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  await addCredential(user.id, {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: body.response?.transports,
    name: deviceLabelFromUA(req.headers.get("user-agent")),
    createdAt: new Date().toISOString(),
  });

  const token = await signSession({ sub: user.id, safe: user.safeAddress });
  // Native clients have no cookie jar — they hold the JWT in the Android
  // Keystore and send it as `Authorization: Bearer`. Same contract as
  // /api/auth/otp/check and /api/auth/guest.
  const res = NextResponse.json({
    verified: true,
    ...(isMobileClient(req) ? { token } : {}),
  });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
