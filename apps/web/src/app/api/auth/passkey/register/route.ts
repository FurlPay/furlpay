import { currentEpoch } from "@/lib/sessionEpoch";
import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import { requireUser } from "@/lib/authz";
import {
  EXPECTED_ORIGINS,
  EXPECTED_RPIDS,
  RP_ID,
  RP_NAME,
  addCredential,
  claimCredentialOwner,
  deviceLabelFromUA,
  getCredentialOwner,
  getCredentials,
  setChallenge,
  takeChallenge,
} from "@/lib/webauthn";
import { setSessionCookieForRequest, signSession } from "@/lib/session";
import { isMobileClient } from "@/lib/clientKind";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PasskeyRegistrationSchema } from "@/lib/schemas/webauthn";

// GET /api/auth/passkey/register — real WebAuthn registration options.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.passkey.register.options", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  // Registration is AUTHENTICATED. The caller must already be signed in --
  // by OTP, Google or Apple -- and the passkey is enrolled onto that account.
  //
  // It used to enrol onto `db.user`, the shared seeded demo account, so every
  // passkey created by anyone landed on one identity. Requiring a session is
  // what makes ownership unambiguous: there is exactly one account it can
  // belong to, and the server already knows which.
  //
  // Both clients already satisfy this. The native app verifies its OTP with
  // `login: true` before calling registerPasskey(); the web signup does the
  // same (see app/signup/page.tsx). An unauthenticated caller gets a 401
  // rather than a credential silently attached to somebody else's account.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;
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
      // REQUIRED, not preferred: sign-in is usernameless (the options endpoint
      // sends no allowCredentials), which only works if the authenticator
      // stores the credential discoverably. "preferred" would let an
      // authenticator create a non-discoverable key that can never be used
      // to sign in.
      residentKey: "required",
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
  // CPU-bound (attestation verification), so tighter than the 150/min
  // baseline even though the caller is authenticated.
  const limited = await rateLimitOr429(req, "auth.passkey.register", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // Same gate as GET: the credential is enrolled onto the SIGNED-IN account,
  // never onto a shared one.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;
  const body = await validateBody(req, PasskeyRegistrationSchema);
  if (body instanceof NextResponse) return body;
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

  // Claim ownership FIRST, and refuse if the id is already spoken for.
  //
  // This is the index that lets authentication resolve a credential back to
  // its owner. SETNX means a credential id can never be repointed at a second
  // account: a duplicate registration is rejected rather than silently
  // rebinding somebody else's passkey. WebAuthn ids are globally unique, so a
  // collision here is a replay or an attack, not a coincidence.
  const claimed = await claimCredentialOwner(credential.id, user.id);
  if (!claimed) {
    const existingOwner = await getCredentialOwner(credential.id);
    // Re-registering your OWN credential is harmless and idempotent; claiming
    // one that belongs to someone else is not.
    if (existingOwner !== user.id) {
      return NextResponse.json({ error: "Credential already registered" }, { status: 409 });
    }
  }

  await addCredential(user.id, {
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: body.response?.transports,
    name: deviceLabelFromUA(req.headers.get("user-agent")),
    createdAt: new Date().toISOString(),
  });

  const token = await signSession({
    sub: user.id,
    safe: user.safeAddress,
    roles: user.roles,
    sepoch: await currentEpoch(user.id),
  });
  // Native clients have no cookie jar — they hold the JWT in the Android
  // Keystore and send it as `Authorization: Bearer`. Same contract as
  // /api/auth/otp/check and /api/auth/guest.
  const res = NextResponse.json({
    verified: true,
    ...(isMobileClient(req) ? { token } : {}),
  });
  setSessionCookieForRequest(req, res, token);
  return res;
}
