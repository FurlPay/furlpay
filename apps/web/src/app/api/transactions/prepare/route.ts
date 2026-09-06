import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { checkDevice } from "@/lib/integrity/device";
import { prepareProposal, updateProposal } from "@/lib/integrity/proposal";
import { simulate } from "@/lib/integrity/simulation";
import { issueChallenge } from "@/lib/integrity/challenge";
import { simulationSummary } from "@/lib/integrity/boundary";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/transactions/prepare — step 1 of 3 on the way to a signature.
//
// The client proposes a transaction. The server canonicalises it, PROVES the
// calldata means what the proposal claims, simulates it, freezes the whole
// thing under an id, and returns the digest the confirmation screen must
// display and every later control must commit to.
//
// WHY THE SERVER CANNOT SIMPLY BUILD THE TRANSACTION ITSELF. Gas parameters
// and the account nonce come from the chain as the client sees it. Inventing
// them here would be guessing, and a guessed nonce produces a transaction that
// either never lands or replaces one that already did. So the client proposes
// and the server verifies — and the verification is not a formality:
// `verifyPayloadMatchesIntent` DECODES the calldata and compares recipient,
// spender, token contract and amount against the intent. A proposal claiming
// "1 USDC to Alice" whose calldata drains the wallet is refused here, before a
// digest exists for anything else to commit to.
//
// WHAT THE CLIENT GETS BACK. A digest, a summary, and a confirmation challenge.
// It gets no authorization and nothing signable: this step ends with the server
// knowing what was asked, and nothing having been approved.
// ---------------------------------------------------------------------------

/** 256-bit values as decimal strings. `number` loses precision above 2^53 and
 *  a wei amount routinely exceeds that. */
const uint256 = z.string().regex(/^\d{1,78}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const PrepareSchema = z.object({
  deviceId: z.string().regex(/^dev_[0-9a-f]{32}$/),
  appInstanceId: z.string().regex(/^inst_[0-9a-f]{32}$/),
  /** The wallet that will sign. */
  walletId: address,
  action: z.enum(["transfer", "approve"]),
  chain: z.string().min(1).max(32),
  assetId: z.string().min(1).max(64),
  amountMinor: uint256,
  destination: address,
  spender: address.optional(),
  payload: z.object({
    chainId: z.number().int().positive(),
    nonce: z.number().int().nonnegative(),
    gasLimit: uint256,
    maxFeePerGas: uint256,
    maxPriorityFeePerGas: uint256,
    to: address,
    value: uint256,
    data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(8192),
  }),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(
    req,
    "transactions.prepare",
    { limit: 60, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const body = await validateBody(req, PrepareSchema);
  if (body instanceof NextResponse) return body;

  // The device first. Preparing a transaction from an unenrolled or revoked
  // device should not even produce a proposal to point at later.
  const deviceCheck = await checkDevice({
    deviceId: body.deviceId,
    userId,
    appInstanceId: body.appInstanceId,
  });
  if (!deviceCheck.ok) {
    audit("mpc.sign_denied", userId, {
      stage: "prepare",
      deviceId: body.deviceId,
      reason: deviceCheck.refusals.join(","),
    });
    return NextResponse.json(
      {
        error: "device_not_authorized",
        detail: "This device is not authorized to start a transaction.",
        // The one refusal worth naming: the app needs to know to run
        // attestation rather than to give up.
        attestationRequired: deviceCheck.refusals.includes("device_not_trusted"),
      },
      { status: 403 }
    );
  }

  const prepared = await prepareProposal({
    userId,
    walletId: body.walletId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
    action: body.action,
    chain: body.chain,
    assetId: body.assetId,
    amountMinor: body.amountMinor,
    destination: body.destination,
    spender: body.spender,
    payload: body.payload,
  });

  if (!prepared.ok) {
    // The refusals ARE named here, unlike at the signing boundary. This step
    // has authorised nothing, and the distinction between "that is the wrong
    // token contract" and "that amount does not match the calldata" is what
    // lets a developer fix a real client bug. Withholding it would buy no
    // security — the caller supplied every one of these values.
    return NextResponse.json(
      {
        error: "proposal_refused",
        detail: "This transaction could not be prepared.",
        reasons: prepared.refusals,
      },
      { status: 400 }
    );
  }

  const proposal = prepared.proposal!;

  // Simulation runs on the STORED payload, and its result is bound to the
  // stored digest. A simulation of anything else is evidence about a different
  // transaction, and the boundary refuses it (`simulation_unbound`).
  const simulation = await simulate({
    intent: proposal.intent,
    payload: proposal.payload,
    digest: proposal.canonicalDigest,
  });
  const withSimulation = await updateProposal(proposal, { simulation });

  // The confirmation challenge. Single-use, unpredictable, bound to this
  // proposal at this version — it is what the device's biometric and platform
  // integrity evidence are produced over, and /api/transactions/authorize
  // consumes it. Issuing it here rather than at authorize is deliberate: the
  // user's approval happens BETWEEN the two calls, so the value that approval
  // commits to has to exist before it.
  const challenge = await issueChallenge({
    userId,
    deviceId: body.deviceId,
    appInstanceId: body.appInstanceId,
    walletId: body.walletId,
    transactionId: withSimulation.intentId,
    transactionVersion: withSimulation.version,
    canonicalDigest: withSimulation.canonicalDigest,
  });

  return NextResponse.json(
    {
      intentId: withSimulation.intentId,
      /**
       * The value everything commits to. The app must display the transaction
       * this describes and echo the digest back at authorize; a mismatch there
       * means the screen and the proposal disagreed, which blocks.
       */
      canonicalDigest: withSimulation.canonicalDigest,
      transactionVersion: withSimulation.version,
      expiresAt: withSimulation.expiresAt,
      confirmation: {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      },
      /** What to render. Derived from the intent the server verified, so the
       *  screen shows the same numbers the policy will price. */
      summary: {
        action: withSimulation.intent.action,
        chain: withSimulation.intent.chain,
        assetId: withSimulation.intent.assetId,
        amountMinor: withSimulation.intent.amountMinor,
        destination: withSimulation.intent.destination,
        spender: withSimulation.intent.spender ?? null,
        maxFeeWei: (
          BigInt(withSimulation.payload.gasLimit) * BigInt(withSimulation.payload.maxFeePerGas)
        ).toString(),
      },
      simulation: {
        outcome: simulation.outcome,
        // Never "this transaction is safe". simulationSummary() will not say it.
        summary: simulationSummary(simulation),
        warnings: simulation.warnings,
        assetChanges: simulation.assetChanges ?? [],
        approval: simulation.approval ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
