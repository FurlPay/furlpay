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
import { recordStepUp } from "@/lib/stepup";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/auth/passkey/authenticate — real WebAuthn authentication options.
export async function GET() {
  const user = db.user;
  const creds = await getCredentials(user.id);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports as any })),
    userVerification: "required",
  });
  await setChallenge(user.id, options.challenge);
  return NextResponse.json(options);
}

// POST /api/auth/passkey/authenticate — verify the assertion (origin, challenge,
// signature counter) and issue a signed session.
export async function POST(req: NextRequest) {
  // Unauthenticated assertion endpoint: tighter than the middleware's 150/min
  // baseline so a stolen/guessed credential id can't be hammered, and a single
  // IP can't burn WebAuthn verification CPU at flood rates.
  const limited = await rateLimitOr429(req, "auth.passkey.authenticate", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const user = db.user;
  const body = await req.json();
  const expectedChallenge = await takeChallenge(user.id);
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No pending challenge" }, { status: 400 });
  }

  const cred = (await getCredentials(user.id)).find((c) => c.id === body.id);
  if (!cred) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      // Includes the Android app's `android:apk-key-hash:` origin — see
      // lib/webauthn.ts. Without it every native assertion fails on origin.
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
  await updateCounter(user.id, cred.id, verification.authenticationInfo.newCounter);

  // Bind the step-up to THIS session's jti (see stepup.ts).
  const jti = crypto.randomUUID();
  const token = await signSession({ sub: user.id, safe: user.safeAddress, jti });
  // A passkey assertion is a strong step-up — satisfies the wallet-link gate.
  void recordStepUp(user.id, jti, "passkey").catch(() => {});
  // Native clients get the JWT in the body (Bearer flow); browsers get the
  // HttpOnly cookie only. See lib/clientKind.ts.
  const res = NextResponse.json({
    verified: true,
    ...(isMobileClient(req) ? { token } : {}),
  });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
