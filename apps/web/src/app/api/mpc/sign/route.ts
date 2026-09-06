import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { authorizeAgentSpend, type AgentSpendCategory } from "@/lib/agentPolicy";
import { signDigest, turnkeyConfigured, TurnkeyError } from "@/lib/services/turnkey";
import { audit } from "@/lib/audit";
import { consumeAuthorization, clientSafeRefusal } from "@/lib/integrity/authorization";
import { checkDevice } from "@/lib/integrity/device";
import { consumeChallenge } from "@/lib/integrity/challenge";
import { loadOwnedProposal, updateProposal } from "@/lib/integrity/proposal";
import { chainPayloadDigest, evmSigningHash } from "@/lib/integrity/evmPayload";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/mpc/sign — co-sign a digest with the server-held MPC share.
//
// THIS IS THE MONEY BOUNDARY. Everything upstream of it is a request; the
// signature it returns is spendable. So policy is enforced HERE, at the point
// of signing, and not only where the agent first asked.
//
// The distinction matters. An agent that calls /api/payments/create has its
// spend authorised at that route. But an agent holding an MPC-backed wallet can
// try to sign anything at all — a transfer the payments route never saw, on a
// chain nobody approved. Gating only the semantic endpoints leaves the raw
// signing capability ungated, which is the whole capability.
//
// THREE INDEPENDENT GATES, deliberately redundant:
//   1. The client refuses to request an out-of-policy signature (MpcSigner).
//   2. This route refuses to forward one (authorizeAgentSpend, below).
//   3. Turnkey's own enclave policy refuses to produce one.
// Any single one failing open still leaves two.
//
// WHAT CHANGED, AND WHY THE OLD CONTRACT WAS THE HOLE.
//
// This route used to accept `{ signWith, digest, context }` where `context`
// was documented as ADVISORY — its own comment said "the digest is
// authoritative and we cannot verify that these fields describe it". That is
// precisely the vulnerability: a caller who reaches this route could sign ANY
// 32 bytes, and the spend policy above was priced from numbers the same caller
// supplied. An agent capped at $50 could present `amountUsd: 10` alongside the
// digest of a transaction draining the wallet, and every gate would pass.
//
// Adding more fields could not fix it. Any field the client sends, the client
// chooses. So the contract inverted: the client no longer DESCRIBES the work,
// it presents an `authorizationId` the SERVER minted after running the full
// transaction-security boundary over ITS OWN copy of the intent
// (lib/integrity/). This route then re-derives the digest from the stored
// intent and signs that — never a digest the client handed it.
//
// The spend policy is now priced from the AUTHORIZED intent for the same
// reason, so it can no longer be lied to.
// ---------------------------------------------------------------------------

const SignSchema = z.object({
  /** Wallet account address Turnkey should sign with. */
  signWith: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /**
   * The server-minted authorization this signature is claimed under.
   *
   * Replaces the old client-supplied `digest`. The server looks up what this
   * authorization actually covers and signs THAT — so a caller can no longer
   * choose the bytes it gets signed.
   */
  authorizationId: z.string().regex(/^auth_[0-9a-f]{32}$/),
  /**
   * The stored proposal this signature is for.
   *
   * The client supplies the ID and nothing else about the transaction. The
   * server reads the proposal, takes the CURRENT version from it, and compares
   * that with the version frozen into the authorization — the TOCTOU check.
   *
   * Taking the version from the request instead would let the caller supply
   * both sides of that comparison, which is not a check at all.
   */
  intentId: z.string().regex(/^itx_[0-9a-f]{32}$/),
  /** The device presenting this request. Verified against the registry — a
   *  client-asserted id is a suggestion, not an identity. */
  deviceId: z.string().regex(/^dev_[0-9a-f]{32}$/),
  appInstanceId: z.string().regex(/^inst_[0-9a-f]{32}$/),
  /** The challenge issued for this exact operation, and its nonce. */
  challengeId: z.string().regex(/^chal_[0-9a-f]{32}$/),
  challengeNonce: z.string().min(32).max(128),
  /** Set when an agent key is driving this, rather than the account owner. */
  agentKeyId: z.string().min(1).max(128).optional(),
});

/**
 * Price the spend from the AUTHORIZED intent, never from client input.
 *
 * The old route took `context.amountUsd` from the request body, which meant the
 * agent budget was enforced against a number the agent chose. This derives it
 * from the intent the server itself canonicalised and stored.
 *
 * Returns null when the asset is not one we can price here, and the caller
 * treats that as a refusal — an unpriceable spend must not default to zero and
 * slip under every budget.
 */
function spendUsdFromIntent(intent: { assetId: string; amountMinor: string }): number | null {
  // Only 1:1 USD-referenced stablecoins are priced inline. Anything else needs
  // a quote, and inventing one here would put a price oracle inside a signing
  // route.
  const STABLE_6DP = new Set([
    "USDC.ethereum",
    "USDC.arbitrum",
    "USDC.base",
    "USDC.polygon",
  ]);
  if (!STABLE_6DP.has(intent.assetId)) return null;
  try {
    const minor = BigInt(intent.amountMinor);
    if (minor < 0n) return null;
    // 6dp minor units to whole USD, rounded up to the cent so a budget is
    // never under-charged by truncation.
    return Number((minor * 100n) / 1_000_000n) / 100;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Tighter than the mutating baseline: this mints signatures.
  const limited = await rateLimitOr429(req, "mpc.sign", { limit: 30, windowMs: 60_000 }, userId);
  if (limited) return limited;

  if (!turnkeyConfigured()) {
    return NextResponse.json(
      { error: "mpc_unavailable", detail: "MPC signing is not enabled on this deployment." },
      { status: 503 }
    );
  }

  const body = await validateBody(req, SignSchema);
  if (body instanceof NextResponse) return body;

  // ── THE SECURITY BOUNDARY ────────────────────────────────────────────────
  //
  // Claim the authorization FIRST, before any other work. The claim is a
  // single-use atomic SET NX (lib/integrity/authorization.ts), so two
  // concurrent replays cannot both proceed — on serverless they would be on
  // different instances, where nothing process-local would notice.
  //
  // `aboutToSign` is the intent as STORED by the server at mint time. Passing
  // the stored intent back through digest derivation is not circular: it is
  // what proves the record was not tampered with between mint and consume, and
  // it is the hook where a chain-specific rebuild will be compared once the
  // signer path constructs one (see docs/TRANSACTION_SECURITY.md).
  // Device first. A revoked or untrusted device must not reach the challenge
  // or the authorization at all — those are cheap to burn, and burning one for
  // a device we were going to refuse anyway turns a refusal into a denial of
  // service against the legitimate user.
  const deviceCheck = await checkDevice({
    deviceId: body.deviceId,
    userId,
    appInstanceId: body.appInstanceId,
  });
  if (!deviceCheck.ok) {
    audit("mpc.sign_denied", userId, {
      deviceId: body.deviceId,
      reason: deviceCheck.refusals.join(","),
    });
    return NextResponse.json(
      { error: "device_not_authorized", detail: "This device is not authorized to sign." },
      { status: 403 }
    );
  }

  // The proposal is the server's own copy of the transaction. Everything that
  // follows reads from it: the version for the TOCTOU check, the payload the
  // signing hash is derived from, and the terminal state that stops a second
  // signature. The client contributed the id and nothing else.
  const loaded = await loadOwnedProposal({
    intentId: body.intentId,
    userId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { error: "proposal_unavailable", detail: "This transaction is no longer available." },
      { status: 409 }
    );
  }
  const proposal = loaded.proposal;

  const claimed = await consumeAuthorization({
    authorizationId: body.authorizationId,
    userId,
    walletId: body.signWith,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
    currentDeviceKeyVersion: deviceCheck.device!.keyVersion,
    challengeId: body.challengeId,
    // From the STORED proposal, never from the request.
    currentTransactionVersion: proposal.version,
    // THE REBUILD CROSS-CHECK. This route does construct something: the
    // chain-level signing hash, from the stored payload. So the payload digest
    // is recomputed from that same stored payload and folded back into the
    // intent, and consume() re-canonicalises the result. If the stored payload
    // has changed since the authorization was minted — by a partial write, a
    // tampered store entry, anything — the digests diverge here and nothing is
    // signed.
    aboutToSign: {
      ...proposal.intent,
      chainPayloadDigest: chainPayloadDigest(proposal.payload),
    },
  });
  if (!claimed.ok) {
    const safe = clientSafeRefusal(claimed.failures);
    return NextResponse.json(safe, { status: safe.retryable ? 409 : 403 });
  }
  const authorization = claimed.authorization!;

  // The challenge proves the live, present device is asking NOW — a different
  // question from whether the transaction is allowed, which the authorization
  // already answered. Consumed after the authorization so a caller cannot burn
  // challenges by guessing authorization ids.
  const challenge = await consumeChallenge({
    challengeId: body.challengeId,
    nonce: body.challengeNonce,
    userId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
    walletId: body.signWith,
    transactionId: authorization.intent.intentId,
    transactionVersion: proposal.version,
    canonicalDigest: authorization.canonicalDigest,
  });
  if (!challenge.ok) {
    audit("signing.authorization_refused", userId, {
      authorizationId: authorization.authorizationId,
      challengeId: body.challengeId,
      reasons: challenge.refusals.join(","),
    });
    return NextResponse.json(
      { error: "authorization_invalid", detail: "This transaction could not be authorized. Start again." },
      { status: 403 }
    );
  }

  // Agent-driven signatures are subject to the agent's spend policy: per-tx
  // limit, daily budget, category allowlist, expiry, revocation. The budget
  // counter fails CLOSED, so a Redis outage stops agent spending rather than
  // silently uncapping it.
  //
  // PRICED FROM THE AUTHORIZED INTENT, not from the request. The old route read
  // `context.amountUsd` out of the client's body, which meant an agent capped
  // at $50 could present `amountUsd: 10` next to a wallet-draining digest and
  // pass every gate.
  if (body.agentKeyId) {
    const amountUsd = spendUsdFromIntent(authorization.intent);
    if (amountUsd === null) {
      // Unpriceable must refuse, not default to zero and slip under the budget.
      audit("mpc.sign_denied", userId, {
        keyId: body.agentKeyId,
        reason: "asset_not_priceable",
        assetId: authorization.intent.assetId,
      });
      return NextResponse.json(
        { error: "policy_denied", detail: "asset_not_priceable" },
        { status: 403 }
      );
    }
    const decision = await authorizeAgentSpend({
      keyId: body.agentKeyId,
      amountUsd,
      category: authorization.intent.action === "transfer" ? "transfer" : ("commerce" as AgentSpendCategory),
    });
    if (!decision.allowed) {
      audit("mpc.sign_denied", userId, {
        keyId: body.agentKeyId,
        reason: decision.reason,
        chain: authorization.intent.chain,
      });
      return NextResponse.json(
        { error: "policy_denied", detail: decision.reason },
        { status: 403 }
      );
    }
    // The key must belong to the caller. Without this, any signed-in user could
    // spend against another account's agent budget by naming its key id.
    if (decision.record && decision.record.userId !== userId) {
      audit("mpc.sign_denied", userId, {
        keyId: body.agentKeyId,
        reason: "key_not_owned",
      });
      return NextResponse.json({ error: "policy_denied", detail: "key_not_owned" }, { status: 403 });
    }
  }

  try {
    // THE BYTES COME FROM THE SERVER'S STORED PAYLOAD, NEVER FROM THE REQUEST.
    // This is the line that closes the original hole: whatever the client asked
    // for, what gets signed is derived from what the server authorised.
    //
    // AND IT IS NOT THE CANONICAL DIGEST. The canonical digest is the BINDING
    // value — the thing simulation, attestation and confirmation all commit to.
    // An EVM chain wants something else entirely: keccak256 of the RLP-encoded
    // unsigned EIP-1559 transaction. Signing the canonical digest would produce
    // 65 valid-looking bytes over the wrong message; the client's own recovery
    // check would reject them, and if it did not, the chain would.
    //
    // The two are tied together by `chainPayloadDigest`, which is folded into
    // the intent and therefore into the canonical digest, and which
    // consumeAuthorization re-derived from this same stored payload above.
    const digestHex = evmSigningHash(proposal.payload);
    const signature = await signDigest({ signWith: body.signWith, digestHex });

    audit("mpc.signed", userId, {
      keyId: body.agentKeyId ?? null,
      authorizationId: authorization.authorizationId,
      chain: authorization.intent.chain,
      to: authorization.intent.destination,
      assetId: authorization.intent.assetId,
      amountMinor: authorization.intent.amountMinor,
      // Both digests are recorded. The canonical one identifies what was
      // AUTHORISED; the signing hash identifies the transaction that will
      // appear on-chain. An incident review needs to join those two, and after
      // the fact only the second is visible from outside.
      digest: authorization.canonicalDigest,
      signingHash: digestHex,
    });

    // Terminal. A proposal that produced a signature must not produce another:
    // the authorization is already single-use, and this closes the same door
    // from the other side, so a second authorization minted against the same
    // proposal cannot resurrect it.
    await updateProposal(proposal, { status: "signed" });

    // Returned as-is. The client normalises v and verifies the signature
    // recovers to the address it expects; doing either here would move a check
    // to the side of the boundary it is meant to be checking.
    return NextResponse.json(
      { r: signature.r, s: signature.s, v: signature.v },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof TurnkeyError) {
      // 202 means Turnkey wants another approver — a real state the UI should
      // explain, not a failure to retry.
      const status = e.status === 202 ? 202 : e.status >= 500 ? 502 : 400;
      return NextResponse.json({ error: "signing_failed", detail: e.message }, { status });
    }
    return NextResponse.json({ error: "signing_failed" }, { status: 500 });
  }
}
