import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSecret, otpauthUrl, verifyTotp } from "@furlpay/security";
import { requireUser } from "@/lib/authz";
import { persistAccount } from "@/lib/store";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { validateBody } from "@/lib/validate";
import { consumeRecoveryCode, generateRecoveryCodes } from "@/lib/mfaRecovery";
import { bumpSessionEpoch } from "@/lib/sessionEpoch";
import { setSessionCookieForRequest, signSession, type Role } from "@/lib/session";

export const dynamic = "force-dynamic";

const MfaBody = z.object({
  action: z.enum(["enroll", "verify", "disable", "regenerate-recovery"]),
  // Long enough for a formatted recovery code (`xxxxx-xxxxx`) as well as a
  // 6-digit TOTP.
  code: z.string().trim().min(6).max(16).optional(),
});

// TOTP MFA management for the AUTHENTICATED user.
//
// This route MUST resolve the acting user from the session and operate on THEIR
// account — earlier it was unauthenticated and always touched the seeded demo
// account (`db`), which meant (a) MFA was non-functional for real users and
// (b) any anonymous caller could enroll/enable/disable TOTP on the shared demo
// account and read back an enrollment secret. Per the repo security rules,
// u.security.totpSecret is only ever written here, and the secret is returned
// exactly once — to the authenticated owner — for QR enrollment.

type Security = { totpSecret: string; totpEnabled: boolean; totpRecoveryCodes?: string[] };

/**
 * End every session for this user, then keep THIS device signed in.
 *
 * Bumping the epoch alone would log the acting tab out too. That is not a
 * security gain — the caller just proved possession of the second factor — and it
 * reads as a crash, so the user re-authenticates for nothing. A fresh cookie
 * carrying the new epoch keeps them where they are; every other device is dead on
 * its next request.
 *
 * `auth_time` is carried over deliberately rather than reset: this was a factor
 * check, not a fresh identity proof, so it must not extend how long the session
 * may keep sliding via /api/auth/refresh.
 */
async function bumpAndReissue(
  req: NextRequest,
  res: NextResponse,
  claims: { jti?: string; auth_time?: number },
  user: { id: string; safeAddress: string; roles: Role[] }
): Promise<void> {
  const epoch = await bumpSessionEpoch(user.id);
  const token = await signSession({
    sub: user.id,
    safe: user.safeAddress,
    roles: user.roles,
    jti: claims.jti,
    auth_time: claims.auth_time,
    sepoch: epoch,
  });
  setSessionCookieForRequest(req, res, token);
}

/**
 * Prove possession of the second factor: a live TOTP code, or a single-use
 * recovery code.
 *
 * Mutates `sec.totpRecoveryCodes` when a recovery code is spent, so the caller
 * must persist afterwards — a consumed code that survives a failed write is a
 * replayable credential.
 */
function verifySecondFactor(
  sec: Security,
  code: string | undefined
): { ok: true; via: "totp" | "recovery" } | { ok: false; error: string; status: number } {
  if (!code) {
    return { ok: false, error: "A current authenticator code or a recovery code is required", status: 400 };
  }
  if (verifyTotp(sec.totpSecret, code)) return { ok: true, via: "totp" };

  const consumed = consumeRecoveryCode(code, sec.totpRecoveryCodes);
  if (consumed.ok) {
    sec.totpRecoveryCodes = consumed.remaining;
    return { ok: true, via: "recovery" };
  }
  // One message for both failures. Saying "that TOTP code is wrong but recovery
  // codes exist" would tell an attacker which factor to work on.
  return { ok: false, error: "Invalid code", status: 401 };
}

// GET /api/security/mfa — MFA status (never returns the secret).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const sec = auth.account.user.security;
  return NextResponse.json({
    totpEnabled: sec.totpEnabled,
    hardwareKeys: sec.hardwareKeys,
    // A COUNT, never the codes or their hashes. The count is what the owner
    // needs ("am I running low?"); anything more would put second factors in a
    // GET response.
    recoveryCodesRemaining: sec.totpRecoveryCodes?.length ?? 0,
  });
}

// POST /api/security/mfa — enroll / verify / disable TOTP.
// body: { action: "enroll" | "verify" | "disable", code? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // MFA enroll/verify is security-sensitive and brute-forceable on verify.
  const limited = await rateLimitOr429(req, "security.mfa", { limit: 10, windowMs: 5 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, MfaBody);
  if (body instanceof NextResponse) return body;
  const user = auth.account.user;
  const sec = user.security;

  if (body.action === "enroll") {
    // Generate a pending secret and return the otpauth URI for QR enrollment.
    // Returned once, to the authenticated owner only.
    const secret = generateSecret();
    sec.totpSecret = secret;
    sec.totpEnabled = false;
    await persistAccount(user.id);
    audit("auth.mfa_enrolled", user.id, {});
    return NextResponse.json({
      secret,
      otpauthUrl: otpauthUrl(secret, user.email),
    });
  }

  if (body.action === "verify") {
    if (!body.code) return NextResponse.json({ error: "code required" }, { status: 400 });
    const ok = verifyTotp(sec.totpSecret, body.code);
    if (!ok) {
      audit("auth.mfa_failed", user.id, {});
      return NextResponse.json({ error: "Invalid code" }, { status: 401 });
    }
    sec.totpEnabled = true;

    // Issue recovery codes at the moment MFA turns on — the only point where the
    // user is present, expecting a security step, and not yet locked out. Asking
    // them to opt in later means the people who need the codes most are exactly
    // the ones who never generate them.
    const { codes, hashes } = generateRecoveryCodes();
    sec.totpRecoveryCodes = hashes;

    await persistAccount(user.id);
    audit("auth.mfa_enabled", user.id, { recoveryCodes: codes.length });
    // The ONLY response that ever contains plaintext codes.
    return NextResponse.json({
      success: true,
      totpEnabled: true,
      recoveryCodes: codes,
      recoveryCodesRemaining: codes.length,
    });
  }

  if (body.action === "regenerate-recovery") {
    // Replacing codes invalidates the old set, so it is a credential change and
    // needs the same proof as disabling.
    if (!sec.totpEnabled) {
      return NextResponse.json({ error: "Enable MFA first" }, { status: 400 });
    }
    const proof = verifySecondFactor(sec, body.code);
    if (!proof.ok) {
      audit("auth.mfa_failed", user.id, { action: "regenerate-recovery" });
      return NextResponse.json({ error: proof.error }, { status: proof.status });
    }

    const { codes, hashes } = generateRecoveryCodes();
    sec.totpRecoveryCodes = hashes;
    await persistAccount(user.id);
    audit("auth.mfa_enabled", user.id, { regenerated: true, recoveryCodes: codes.length });
    return NextResponse.json({ success: true, recoveryCodes: codes, recoveryCodesRemaining: codes.length });
  }

  if (body.action === "disable") {
    // PROOF OF POSSESSION IS REQUIRED HERE.
    //
    // This used to flip `totpEnabled` to false on nothing but a session cookie.
    // That made the second factor removable with only the FIRST factor: anyone
    // holding a stolen session — XSS, a borrowed laptop, a lifted cookie — could
    // strip MFA silently and keep long-term access, which is the exact attack
    // MFA is bought to stop. Worse, the downgrade was invisible: the secret was
    // left in place, so re-enabling later looked like nothing had happened.
    //
    // A current TOTP code or a single-use recovery code is now required.
    const proof = verifySecondFactor(sec, body.code);
    if (!proof.ok) {
      audit("auth.mfa_failed", user.id, { action: "disable" });
      return NextResponse.json({ error: proof.error }, { status: proof.status });
    }

    sec.totpEnabled = false;
    // Clear the secret and the recovery codes rather than leaving them behind:
    // a disabled factor whose material is still stored is a credential nobody is
    // watching, and re-enrolment mints a fresh secret anyway.
    sec.totpSecret = "";
    sec.totpRecoveryCodes = [];
    await persistAccount(user.id);

    // Removing a factor is exactly the event that should end sessions elsewhere.
    // If this was an attacker's doing, every other device they had is now dead;
    // if it was the owner, the tab they are using continues because we re-issue
    // its cookie below.
    const res = NextResponse.json({ success: true, totpEnabled: false, sessionsEnded: true });
    await bumpAndReissue(req, res, auth.claims, user);

    audit("auth.mfa_disabled", user.id, { via: proof.via, sessionsRevoked: true });
    return res;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
