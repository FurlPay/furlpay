import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { requireUser } from "@/lib/authz";
import { RP_ID, getCredentials } from "@/lib/webauthn";
import { bindWebauthnChallenge, getChallenge } from "@/lib/services/cardAuthChallenges";

// POST /api/cards/challenges/options — WebAuthn assertion options for
// approving ONE specific card-auth challenge. The generated WebAuthn
// challenge is stored on the card-auth challenge record itself, so the
// resulting biometric signature is cryptographically bound to this purchase
// and cannot be replayed to approve a different one.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const { challengeId } = await readJsonBody(req).catch(() => ({}));
  if (typeof challengeId !== "string" || !challengeId) {
    return NextResponse.json({ error: "challengeId required" }, { status: 400 });
  }

  const challenge = await getChallenge(challengeId);
  if (!challenge || challenge.userId !== user.id) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }
  if (challenge.status !== "pending") {
    return NextResponse.json({ error: `Challenge already ${challenge.status}` }, { status: 409 });
  }

  const creds = await getCredentials(user.id);
  if (!creds.length) {
    return NextResponse.json(
      { error: "No passkey enrolled — register a fingerprint/Face ID in Security first" },
      { status: 412 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports as any })),
    userVerification: "required", // biometric / device PIN, not just presence
  });

  await bindWebauthnChallenge(challenge.id, options.challenge);
  return NextResponse.json(options);
}
