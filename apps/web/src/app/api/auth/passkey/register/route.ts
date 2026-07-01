import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/store";
import {
  ORIGIN,
  RP_ID,
  RP_NAME,
  addCredential,
  getCredentials,
  setChallenge,
  takeChallenge,
} from "@/lib/webauthn";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// GET /api/auth/passkey/register — real WebAuthn registration options.
export async function GET() {
  const user = db.user;
  const existing = getCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: existing.map((c) => ({ id: c.id })),
  });
  setChallenge(user.id, options.challenge);
  return NextResponse.json(options);
}

// POST /api/auth/passkey/register — verify attestation, store the credential,
// and issue a signed session on success.
export async function POST(req: NextRequest) {
  const user = db.user;
  const body = await req.json();
  const expectedChallenge = takeChallenge(user.id);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No pending challenge" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  addCredential(user.id, {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: body.response?.transports,
  });

  const token = await signSession({ sub: user.id, safe: user.safeAddress });
  const res = NextResponse.json({ verified: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
