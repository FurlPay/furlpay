import { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "@/lib/clientIp";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { BeneficiarySchema } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { rampGuard, STEP_UP_WINDOW_MS } from "@/lib/ramp/rampGuard";
import {
  BeneficiaryEncryptionUnavailable,
  beneficiaryVerifier,
  createBeneficiary,
  getUserBeneficiaries,
} from "@/lib/ramp/beneficiary";
import { checkFeature } from "@/lib/kycTiers";
import { recentStepUp } from "@/lib/stepup";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/offramp/beneficiary — add a bank account for off-ramp payouts.
//
// REFUSES TODAY (503 beneficiary_verification_unavailable). No penny-drop /
// account-validation partner is integrated (lib/ramp/beneficiary.ts), so an
// account added here could never be verified. Collecting and storing bank
// account numbers with no way to use them is a liability, not a feature.
//
// When a verifier exists, the order is: auth → body (whitelisted fields) →
// KYC tier 2 → embargo / velocity → step-up (add_payee, always required) →
// encrypted storage → penny-drop → name match → 24h cooling.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "offramp.beneficiary", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // Before the body is read, so no account number is ever received for nothing.
  if (!beneficiaryVerifier()) {
    return NextResponse.json(
      {
        error: "beneficiary_verification_unavailable",
        detail: "Bank payouts are not available yet: FurlPay cannot verify bank accounts.",
      },
      { status: 503 }
    );
  }

  const body = await validateBody(req, BeneficiarySchema);
  if (body instanceof NextResponse) return body;

  const feature = checkFeature(account.user.kycTier, "canWithdrawToExternal");
  if (!feature.allowed) {
    return NextResponse.json({ error: feature.code, detail: feature.reason }, { status: 403 });
  }

  // Embargo + velocity. Amount 0: adding an account moves no money.
  const guard = await rampGuard({
    req,
    auth: { type: "user", user: account.user, jti: auth.claims.jti },
    direction: "offramp",
    flowType: "server-initiated",
    amountUsd: 0,
  });
  if (!guard.pass) return guard.response;

  // Changing where money goes is the account-takeover move; always stepped up.
  if (!(await recentStepUp(account.user.id, auth.claims.jti, STEP_UP_WINDOW_MS))) {
    return NextResponse.json(
      {
        error: "step_up_required",
        message: "Adding a bank account requires additional verification.",
        action: { type: "step_up", methods: ["otp", "passkey"] },
      },
      { status: 401 }
    );
  }

  let beneficiary;
  try {
    beneficiary = await createBeneficiary({
      userId: account.user.id,
      accountHolderName: body.accountHolderName,
      accountNumber: body.accountNumber,
      bankCode: body.bankCode,
      bankName: body.bankName,
      country: body.country,
      currency: body.currency,
      ip: trustedClientIp(req) ?? undefined,
    });
  } catch (e) {
    if (e instanceof BeneficiaryEncryptionUnavailable) {
      return NextResponse.json(
        { error: "beneficiary_storage_unavailable", detail: "Bank account storage is not configured." },
        { status: 503 }
      );
    }
    throw e;
  }

  // Display-safe fields only (AGENTS.md rule 5).
  return NextResponse.json(
    {
      id: beneficiary.id,
      accountHolderName: beneficiary.accountHolderName,
      accountNumberLast4: beneficiary.accountNumberLast4,
      bankCode: beneficiary.bankCode,
      bankName: beneficiary.bankName,
      country: beneficiary.country,
      currency: beneficiary.currency,
      status: beneficiary.status,
    },
    { status: 201 }
  );
}

// GET /api/offramp/beneficiary — the user's bank accounts, plus whether adding
// one is possible at all, so clients can say so instead of showing a form.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "offramp.beneficiary.list", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const beneficiaries = await getUserBeneficiaries(auth.account.user.id);
  return NextResponse.json({ available: beneficiaryVerifier() !== null, beneficiaries });
}
