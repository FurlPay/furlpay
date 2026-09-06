import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { checkDevice, recordAttestation } from "@/lib/integrity/device";
import { loadOwnedProposal, updateProposal } from "@/lib/integrity/proposal";
import { consumeChallenge, issueChallenge } from "@/lib/integrity/challenge";
import { mintAuthorization, clientSafeRefusal } from "@/lib/integrity/authorization";
import { verifyIntegrity } from "@/lib/integrity/providers";
import { audit } from "@/lib/audit";
import type { AppIntegritySignal } from "@/lib/integrity/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/transactions/authorize — step 2 of 3. The security boundary runs
// here, and this is the only place an authorization can come from.
//
// WHAT THE CLIENT PRESENTS: the proposal id, the digest it actually DISPLAYED,
// the confirmation challenge it was given at prepare, and whatever platform
// integrity evidence the device could produce.
//
// WHY THE ECHOED DIGEST MATTERS. On its own it proves nothing — a client that
// wanted to lie would echo whatever the server sent it. It is a CONSISTENCY
// check, and the thing it catches is a client that rendered one transaction and
// confirmed another. That is a UI bug far more often than an attack, and both
// must block, because from the user's side they are the same event: they
// approved something other than what happens.
//
// WHY THE INTEGRITY TOKEN IS VERIFIED AGAINST OUR OWN DIGEST. `requestHash` /
// `clientDataHash` are only worth anything if the server recomputes the value
// independently and compares. Accepting the client's copy would verify the
// token against whatever the attacker wanted it to say — a valid token bound to
// content nobody checked.
//
// THE ASYMMETRY, restated because it is easy to "fix" by mistake: a MISSING
// attestation does not block. Apple's own guidance is to onboard App Attest
// gradually; hard-gating turns away old hardware, de-Googled Android and
// enterprise builds — real customers — while an attacker simply moves to
// whichever platform passes. A MISMATCHED attestation always blocks, because a
// token minted for different content proves something rewrote the request.
// ---------------------------------------------------------------------------

const AuthorizeSchema = z.object({
  intentId: z.string().regex(/^itx_[0-9a-f]{32}$/),
  deviceId: z.string().regex(/^dev_[0-9a-f]{32}$/),
  appInstanceId: z.string().regex(/^inst_[0-9a-f]{32}$/),
  /**
   * The digest the app DISPLAYED and the user approved. Compared against the
   * server's own stored value — see the header.
   */
  displayedDigest: z.string().regex(/^[0-9a-f]{64}$/),
  /** The confirmation challenge issued at prepare. Single-use. */
  challengeId: z.string().regex(/^chal_[0-9a-f]{32}$/),
  challengeNonce: z.string().min(32).max(128),
  confirmation: z.object({
    /** How the user approved: "biometric", "passcode", "device_credential". */
    method: z.string().min(1).max(64),
  }),
  /** Platform integrity evidence. Absent is a supported, weighted state. */
  integrity: z
    .object({
      platform: z.enum(["ios", "android"]),
      token: z.string().min(1).max(16_384),
      /** Per-installation key id, for App Attest assertion-counter tracking. */
      keyId: z.string().max(256).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(
    req,
    "transactions.authorize",
    { limit: 30, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const body = await validateBody(req, AuthorizeSchema);
  if (body instanceof NextResponse) return body;

  // Device first, before anything single-use is spent. Burning the confirmation
  // challenge for a device we were always going to refuse turns a refusal into
  // a denial of service against the legitimate user, who then has to start the
  // payment over.
  const deviceCheck = await checkDevice({
    deviceId: body.deviceId,
    userId,
    appInstanceId: body.appInstanceId,
  });
  if (!deviceCheck.ok) {
    audit("mpc.sign_denied", userId, {
      stage: "authorize",
      deviceId: body.deviceId,
      reason: deviceCheck.refusals.join(","),
    });
    return NextResponse.json(
      { error: "device_not_authorized", detail: "This device is not authorized to sign." },
      { status: 403 }
    );
  }
  const device = deviceCheck.device!;

  const loaded = await loadOwnedProposal({
    intentId: body.intentId,
    userId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
  });
  if (!loaded.ok) {
    // One message for every reason. "Not found" and "belongs to someone else"
    // must be indistinguishable, or the endpoint becomes an oracle for which
    // proposal ids exist.
    return NextResponse.json(
      { error: "proposal_unavailable", detail: "This transaction is no longer available." },
      { status: 409 }
    );
  }
  const proposal = loaded.proposal;

  // Consume the confirmation challenge. This is what proves the live, present,
  // correct device is the one confirming — a different question from whether
  // the transaction is allowed, which the boundary answers below.
  const challenge = await consumeChallenge({
    challengeId: body.challengeId,
    nonce: body.challengeNonce,
    userId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
    walletId: proposal.walletId,
    transactionId: proposal.intentId,
    transactionVersion: proposal.version,
    canonicalDigest: proposal.canonicalDigest,
  });
  if (!challenge.ok) {
    audit("signing.authorization_refused", userId, {
      stage: "authorize",
      intentId: proposal.intentId,
      reasons: challenge.refusals.join(","),
    });
    return NextResponse.json(
      { error: "authorization_invalid", detail: "This transaction could not be authorized. Start again." },
      { status: 403 }
    );
  }

  // Platform integrity, verified against the SERVER's digest.
  let integrity: AppIntegritySignal | null = null;
  if (body.integrity) {
    integrity = await verifyIntegrity({
      platform: body.integrity.platform,
      token: body.integrity.token,
      // Never `body.displayedDigest`. The point of request binding is that both
      // sides derive the value independently and compare.
      expectedDigest: proposal.canonicalDigest,
      challenge: body.challengeNonce,
      keyId: body.integrity.keyId,
    });
    // Record what the platform said about this device, so a pattern of failing
    // verdicts is visible on the device record rather than only in one request.
    if (integrity.verdict === "failed") {
      await recordAttestation(device.deviceId, device.attestationStatus);
    }
  }

  // The confirmation is bound to the digest the app DISPLAYED, not to the one
  // the server stored. That is what makes `confirmation_unbound` capable of
  // firing: binding it to our own value would compare the server against itself
  // and pass unconditionally.
  const confirmation = {
    boundDigest: body.displayedDigest,
    confirmedAt: new Date().toISOString(),
    method: body.confirmation.method,
  };
  // ONE update, recording the confirmation and the status together. Two
  // updates would bump the version twice, and everything below binds to the
  // version — a second bump after the challenge was issued would invalidate it
  // for no reason anyone could see from the outside.
  const confirmed = await updateProposal(proposal, { confirmation, status: "authorized" });

  // The signing challenge, issued now that the version is settled. It bridges
  // this call and /api/mpc/sign, which are milliseconds apart — so unlike the
  // confirmation challenge it is not carrying a user's approval. What it buys
  // is that the signing request is single-use INDEPENDENTLY of the
  // authorization, and it is the value a second, higher-assurance biometric
  // will be produced over for large transfers (see docs/TRANSACTION_SECURITY).
  const signingChallenge = await issueChallenge({
    userId,
    deviceId: device.deviceId,
    appInstanceId: device.appInstanceId,
    walletId: confirmed.walletId,
    transactionId: confirmed.intentId,
    transactionVersion: confirmed.version,
    canonicalDigest: confirmed.canonicalDigest,
  });

  const minted = await mintAuthorization({
    intent: confirmed.intent,
    expected: { nonce: confirmed.intent.nonce, accountId: confirmed.intent.accountId },
    userId,
    walletId: confirmed.walletId,
    deviceId: device.deviceId,
    appInstanceId: device.appInstanceId,
    deviceKeyVersion: device.keyVersion,
    challengeId: signingChallenge.challengeId,
    transactionVersion: confirmed.version,
    simulation: confirmed.simulation,
    integrity,
    confirmation,
  });

  if (!minted.ok) {
    // Void it. The proposal carried a confirmation that the boundary refused,
    // and leaving it re-authorisable would mean a second attempt inherits an
    // approval the user gave for a transaction we already declined.
    await updateProposal(confirmed, { status: "void" });
    const safe = clientSafeRefusal(minted.failures);
    return NextResponse.json(safe, { status: safe.retryable ? 409 : 403 });
  }

  const authorization = minted.authorization!;

  return NextResponse.json(
    {
      authorizationId: authorization.authorizationId,
      expiresAt: authorization.expiresAt,
      // The version the authorization was minted under. /api/mpc/sign compares
      // it with the proposal's CURRENT version, so a proposal that moves after
      // this point cannot be signed against this authorization.
      transactionVersion: authorization.transactionVersion,
      signing: {
        challengeId: signingChallenge.challengeId,
        nonce: signingChallenge.nonce,
      },
      /** Surfaced even on success — an unlimited approval is not a refusal, and
       *  hiding it because we allowed the transaction defeats the point. */
      warnings: authorization.warnings,
      integrity: {
        verdict: integrity?.verdict ?? "unsupported",
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
