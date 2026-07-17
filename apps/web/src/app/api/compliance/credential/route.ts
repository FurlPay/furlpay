import { NextRequest, NextResponse } from "next/server";
import { issueCredential, verifyCredential } from "@furlpay/compliance";
import { requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const SECRET = process.env.FURLPAY_CREDENTIAL_SECRET || "furlpay_credential_issuer_sandbox";

// POST /api/compliance/credential — issue or verify a reusable KYC credential.
// body: { action: "issue" } | { action: "verify", credential }
//
// Issuing must be AUTHENTICATED and bound to the acting user's own verified KYC.
// Previously it was unauthenticated and issued a SIGNED credential attesting the
// seeded demo account's KYC to any anonymous caller — an attacker could mint a
// signed "KYC-verified" credential without an account.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;
  const body = await req.json().catch(() => ({}));

  if (body.action === "issue") {
    if (user.kycStatus !== "verified") {
      return NextResponse.json({ error: "Complete KYC before issuing a credential" }, { status: 403 });
    }
    const credential = issueCredential(
      user.id,
      {
        ageOver18: true,
        jurisdiction: user.region,
        sanctionsClear: true,
        tier: user.kycTier,
      },
      SECRET
    );
    // "Verify once, use everywhere": the credential is reusable across actions.
    return NextResponse.json({ credential });
  }

  if (body.action === "verify") {
    if (!body.credential) return NextResponse.json({ error: "credential required" }, { status: 400 });
    const check = verifyCredential(body.credential, SECRET);
    return NextResponse.json({ check, attributes: check.valid ? body.credential.attributes : null });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
