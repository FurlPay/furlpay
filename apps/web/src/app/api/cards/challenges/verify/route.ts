import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { requireUser } from "@/lib/authz";
import { EXPECTED_ORIGINS, EXPECTED_RPIDS, getCredentials, updateCounter } from "@/lib/webauthn";
import { decideChallenge, getChallenge } from "@/lib/services/cardAuthChallenges";
import { getAccount, newTx, recordTransaction } from "@/lib/store";
import { log } from "@/lib/log";

// POST /api/cards/challenges/verify — resolve a 3DS2 OOB challenge.
//
// body: { challengeId, decision: "approved" | "declined", assertion? }
//
// APPROVE requires a real WebAuthn assertion (biometric / passkey) whose
// server-side challenge was bound to this specific card-auth challenge by
// /options — the issuer's ACS treats our answer as the cardholder
// authentication result. DECLINE needs only the authenticated session:
// refusing money movement must never be harder than allowing it.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const body = await req.json().catch(() => ({}));
  const { challengeId, decision, assertion } = body ?? {};
  if (typeof challengeId !== "string" || (decision !== "approved" && decision !== "declined")) {
    return NextResponse.json({ error: "challengeId and decision required" }, { status: 400 });
  }

  const challenge = await getChallenge(challengeId);
  if (!challenge || challenge.userId !== user.id) {
    return NextResponse.json({ error: "Challenge expired or not found" }, { status: 404 });
  }
  if (challenge.status !== "pending") {
    return NextResponse.json({ error: `Challenge already ${challenge.status}` }, { status: 409 });
  }

  if (decision === "declined") {
    await decideChallenge(challenge.id, "declined", "declined_by_user");
    return NextResponse.json({ success: true, status: "declined", message: "Transaction declined by user" });
  }

  // --- Approval path: verify the biometric assertion ------------------------
  const expectedChallenge = challenge.webauthnChallenge;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "No pending biometric ceremony — call /options first" }, { status: 400 });
  }
  const cred = getCredentials(user.id).find((c) => c.id === assertion?.id);
  if (!cred) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: EXPECTED_RPIDS,
      requireUserVerification: true,
      credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter },
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid biometric credential signature: ${e.message}` }, { status: 400 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Invalid biometric credential signature" }, { status: 400 });
  }
  updateCounter(user.id, cred.id, verification.authenticationInfo.newCounter);

  const decided = await decideChallenge(challenge.id, "approved", "approved_by_biometric");
  if (!decided) {
    // Raced with expiry or a concurrent decision — fail closed.
    return NextResponse.json({ error: "Challenge expired or not found" }, { status: 409 });
  }

  // Book the spend that was held pending the challenge.
  const account = getAccount(user.id);
  const card = account?.cards.find((c) => c.id === challenge.cardId);
  if (account && card) {
    card.limits.dailySpent += challenge.amountUsd;
    recordTransaction(
      user.id,
      newTx({
        category: "card",
        direction: "out",
        title: challenge.merchant.name,
        subtitle: `${card.label} · ${card.network} · 3DS approved`,
        amountUsd: challenge.amountUsd,
        cardId: card.id,
        status: "settled",
      })
    );
  }

  log.info("3DS2 OOB challenge approved via passkey", {
    challengeId: challenge.id,
    authorizationId: challenge.authorizationId,
    amountUsd: challenge.amountUsd,
  });
  return NextResponse.json({ success: true, status: "approved", message: "Transaction authorized" });
}
