import { NextRequest, NextResponse } from "next/server";
import { issueCredential, verifyCredential } from "@furlpay/compliance";
import { db } from "@/lib/store";

const SECRET = process.env.FURLPAY_CREDENTIAL_SECRET || "furlpay_credential_issuer_sandbox";

// POST /api/compliance/credential — issue or verify a reusable KYC credential.
// body: { action: "issue" } | { action: "verify", credential }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "issue") {
    if (db.user.kycStatus !== "verified") {
      return NextResponse.json({ error: "Complete KYC before issuing a credential" }, { status: 403 });
    }
    const credential = issueCredential(
      db.user.id,
      {
        ageOver18: true,
        jurisdiction: db.user.region,
        sanctionsClear: true,
        tier: db.user.kycTier,
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
