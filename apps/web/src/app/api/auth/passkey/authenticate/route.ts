import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/store";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  getCredentials,
  setChallenge,
  takeChallenge,
  updateCounter,
} from "@/lib/webauthn";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

// GET /api/auth/passkey/authenticate — real WebAuthn authentication options.
export async function GET() {
  const user = db.user;
  const creds = getCredentials(user.id);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports as any })),
    userVerification: "required",
  });
  setChallenge(user.id, options.challenge);
  return NextResponse.json(options);
}

// POST /api/auth/passkey/authenticate — verify the assertion (origin, challenge,
// signature counter) and issue a signed session.
export async function POST(req: NextRequest) {
  const user = db.user;
  const body = await req.json();
  const expectedChallenge = takeChallenge(user.id);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No pending challenge" }, { status: 400 });
  }

  const cred = getCredentials(user.id).find((c) => c.id === body.id);
  if (!cred) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: EXPECTED_RPIDS,
      credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ verified: false }, { status: 401 });
  }

  // Counter must increase for non-synced authenticators (clone detection).
  updateCounter(user.id, cred.id, verification.authenticationInfo.newCounter);

  const token = await signSession({ sub: user.id, safe: user.safeAddress });
  const res = NextResponse.json({ verified: true });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
