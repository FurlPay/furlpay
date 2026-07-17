import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { revokeSession, clearSessionCookie } from "@/lib/session";
import { recentStepUp, consumeStepUp } from "@/lib/stepup";
import { deleteUserAccount, RETENTION_NOTICE } from "@/lib/accountDeletion";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// DELETE /api/account — erase the signed-in user's account.
//
// Required by Google Play (an app that creates accounts must let the user
// delete one in-app) and by GDPR erasure. The retention split it applies is
// the schema's, documented in lib/accountDeletion.ts.
//
// IDOR is structurally impossible: the subject is ALWAYS auth.account.user.id
// from the verified session. No user id is read from the body, query or
// headers — there is no id for an attacker to tamper with.
//
// GET /api/account — what deletion would do, so the confirmation UI can state
// the retention model instead of guessing at it.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  return NextResponse.json({
    // Whether this session has already re-authenticated recently. The UI uses
    // it to send the user through step-up BEFORE showing the final confirm.
    stepUpSatisfied: await recentStepUp(auth.account.user.id, auth.claims.jti),
    retained: RETENTION_NOTICE,
  });
}

export async function DELETE(req: NextRequest) {
  // Destructive and irreversible: a much tighter budget than the mutating
  // baseline. A stolen session should not be able to grind at this.
  const limited = await rateLimitOr429(req, "account.delete", { limit: 5, windowMs: 3_600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const user = auth.account.user;

  // Guest sessions resolve to the SEEDED DEMO ACCOUNT (see /api/auth/guest).
  // Letting a guest delete it would wipe the shared demo surface for everyone.
  if (auth.claims.guest) {
    return NextResponse.json(
      { error: "forbidden", detail: "Demo sessions cannot delete the account." },
      { status: 403 }
    );
  }

  // Step-up re-auth, session-bound (lib/stepup.ts): a stolen session alone must
  // not be able to erase an account. Same gate wallet-linking uses. Local device
  // biometrics do NOT count — they gate the device key, not the FurlPay account.
  if (!(await recentStepUp(user.id, auth.claims.jti))) {
    return NextResponse.json(
      {
        error: "stepup_required",
        detail: "Re-verify with a login code or passkey, then confirm deletion.",
      },
      { status: 403 }
    );
  }

  let outcome;
  try {
    outcome = await deleteUserAccount(user.id);
  } catch (e) {
    // The tombstone is written before any destructive step, so a failure here
    // leaves an account that can no longer authenticate and a deletion that
    // completes on retry — never a half-erased account that still logs in.
    log.error("account deletion failed", { userId: user.id, error: (e as Error).message });
    audit("account.deleted", user.id, { outcome: "failed" });
    return NextResponse.json(
      { error: "deletion_failed", detail: "Deletion could not be completed. Please try again." },
      { status: 500 }
    );
  }

  // Kill the session that just did this, and consume the step-up so it cannot
  // be replayed against anything else.
  await consumeStepUp(user.id, auth.claims.jti);
  await revokeSession(auth.claims.jti);

  const res = NextResponse.json({
    deleted: outcome.deleted,
    erased: outcome.erased,
    retained: outcome.retained,
  });
  clearSessionCookie(res);
  return res;
}
