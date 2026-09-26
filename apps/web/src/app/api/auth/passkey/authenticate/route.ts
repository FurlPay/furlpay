import { currentEpoch } from "@/lib/sessionEpoch";
import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getAccountDurable } from "@/lib/store";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  abandonCeremonyChallenge,
  consumeCeremonyChallenge,
  getCredentialOwner,
  getCredentials,
  putCeremonyChallenge,
  updateCounter,
} from "@/lib/webauthn";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { recordStepUp } from "@/lib/stepup";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PasskeyAbandonSchema, PasskeyAuthenticationSchema } from "@/lib/schemas/webauthn";

// GET /api/auth/passkey/authenticate — real WebAuthn authentication options.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.passkey.authenticate.options", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // No user, and no allowCredentials.
  //
  // The options endpoint is called before anyone has identified themselves, so
  // it CANNOT know whose credentials to list -- that is what the assertion is
  // about to tell us. The old code answered by listing `db.user`'s
  // credentials, which is where the shared-demo-account bug started.
  //
  // Omitting allowCredentials is the discoverable-credential ("usernameless")
  // flow: the authenticator offers the passkeys it holds for this RP ID and
  // the assertion carries the credential id, which POST resolves to an owner.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
  });
  // Keyed by the challenge itself, not by a user we do not have yet.
  await putCeremonyChallenge(options.challenge);
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

  const body = await validateBody(req, PasskeyAuthenticationSchema);
  if (body instanceof NextResponse) return body;

  // THE FIX: resolve the owner FROM THE CREDENTIAL, before verifying anything.
  //
  // A WebAuthn assertion identifies a credential, not a person. Turning one
  // into the other is the relying party's job, and it was not being done: the
  // route read `db.user` -- the shared seeded demo account -- so whichever
  // passkey was presented, the session issued was the demo account's.
  //
  // Looking the owner up first also means the public key used for
  // verification belongs to that owner by construction, which is what makes
  // cross-account confusion impossible rather than merely unlikely.
  const ownerId = await getCredentialOwner(body.id);
  const account = ownerId ? await getAccountDurable(ownerId) : undefined;
  const cred = ownerId ? (await getCredentials(ownerId)).find((c) => c.id === body.id) : undefined;

  // One generic answer for "no such credential", "no such owner" and "owner
  // has no such credential". Distinguishing them would let a caller probe
  // which credential ids exist (OWASP: no enumeration via auth responses).
  if (!ownerId || !account || !cred) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 401 });
  }

  const user = account.user;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      // Consumed on read, so a challenge verifies at most one assertion.
      // Passing a predicate lets SimpleWebAuthn hand us the challenge the
      // authenticator actually signed over, which is the only way to look it
      // up when the ceremony was not user-scoped.
      expectedChallenge: (challenge) => consumeCeremonyChallenge(challenge),
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
  // `roles` carried like every other sign-in path (google/apple/otp). The old
  // code omitted it because the session it minted was always the demo
  // account's; a session for a REAL resolved user must carry that user's own
  // authorization claims and nobody else's.
  const token = await signSession({
    sub: user.id,
    safe: user.safeAddress,
    roles: user.roles,
    jti,
    sepoch: await currentEpoch(user.id),
  });
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

// DELETE /api/auth/passkey/authenticate — abandon a ceremony the client stopped
// waiting for. Body: { challenge }.
//
// THE RACE THIS CLOSES. A caller that bounds the ceremony with a timeout (the
// card reveal gate does, at 60s) can stop waiting, but it cannot recall an
// assertion already in flight. POST above grants a session AND calls
// recordStepUp(), so a ceremony completing after the client gave up would
// silently establish authorization the user was told had failed — satisfying the
// wallet-link and account step-up gates minutes later.
//
// Cancelling the browser prompt does not fix that: a prompt already answered is
// already travelling. Only the server can refuse the result, and the challenge is
// how it refuses — deleting it makes verification fail at consumeCeremonyChallenge,
// before any credential lookup, before a session is signed, and before
// recordStepUp is reached.
//
// UNAUTHENTICATED BY NECESSITY, and safe: the caller has no session yet (this is
// the login path too). Knowing a challenge is the only capability required, and a
// challenge is a 32-byte random value the server itself just issued to this
// client. An attacker who could guess one could only DELETE a pending ceremony —
// a denial of service against a single login attempt that resolves by retrying,
// never an escalation. The same rate limit as the options endpoint applies.
export async function DELETE(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.passkey.authenticate.abandon", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await validateBody(req, PasskeyAbandonSchema);
  if (body instanceof NextResponse) return body;

  await abandonCeremonyChallenge(body.challenge);
  // Always 200. Whether a challenge was there is not the caller's business, and
  // reporting it would turn this into a probe for live ceremonies.
  return NextResponse.json({ abandoned: true });
}
