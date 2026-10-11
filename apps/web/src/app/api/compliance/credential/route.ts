import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { issueCredential, verifyCredential } from "@furlpay/compliance";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { credentialSecret } from "@/lib/compliance/credentialSecret";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  // Unknown fields are stripped, not rejected: a client trying to supply its own
  // attributes gets a credential with the server's attributes (tested).
  z.object({ action: z.literal("issue") }),
  z.object({
    action: z.literal("verify"),
    credential: z
      .object({
        id: z.string().max(64),
        subject: z.string().max(128),
        attributes: z.record(z.unknown()),
        issuedAt: z.number().int().nonnegative(),
        expiresAt: z.number().int().nonnegative(),
        signature: z.string().max(256),
      })
      .passthrough(),
  }).strict(),
]);

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

  const secret = credentialSecret();
  if (!secret) {
    return NextResponse.json({ error: "credentials_unavailable", detail: "Credential signing is not configured on this deployment." }, { status: 503 });
  }

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;
  const user = auth.account.user;

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
      secret
    );
    // "Verify once, use everywhere": the credential is reusable across actions.
    return NextResponse.json({ credential });
  }

  const credential = body.credential as unknown as Parameters<typeof verifyCredential>[0];
  const check = verifyCredential(credential, secret);
  return NextResponse.json({ check, attributes: check.valid ? credential.attributes : null });
}
