import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { requiresStepUp, verifyTotp } from "@furlpay/security";
import { evaluateTransferRisk } from "@/lib/trust/trustBridge";
import { validateAndConsumeBiometricProof } from "@/lib/biometrics/biometricPay";
import { newTx, recordTransaction, type UserAccount } from "@/lib/store";
import { verifyTransferSignature } from "@/lib/signature";
import { recordMovement } from "@/lib/ledger";
import { TransferSchema, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { audit } from "@/lib/audit";
import { checkVelocity, commitVelocity } from "@/lib/services/velocity";
import { analyzeDevice } from "@/lib/services/deviceIntel";
import { withIdempotency } from "@/lib/idempotency";
import { checkTransferAmount } from "@/lib/kycTiers";
import { notifyTransaction } from "@/lib/notify";

/** Chains that can be stored on a Transaction — the `Chain` union in @furlpay/types. */
const TX_CHAINS = [
  "ethereum",
  "polygon",
  "base",
  "arbitrum",
  "arc",
  "solana",
  "gnosis",
  "robinhood",
  "bsc",
] as const;

// POST /api/wallets/transfer — gas-sponsored L2 stablecoin transfer via
// Paymaster, from the SESSION user's balances.
// body: { safeAddress, destination, amount, token, chain, signature, mfaCode?, deviceSignals? }
// `amount` is denominated in TOKEN units, not USD. It is converted to USD once,
// at the caller's own priced balance, for the KYC/velocity/step-up gates.
// Retries are safe: send an Idempotency-Key header (UUID) — a duplicate key
// replays the original response instead of double-spending.
export async function POST(req: NextRequest) {
  // Settlement below is the demo ledger only: it mints a mock hash — no L2
  // transfer exists behind this route yet. NOTE: gate on NODE_ENV, not
  // liveOr503()/INTEGRATION_MODE — the mode flag is set to live in prod for
  // the x402 rail, but it cannot make THIS route real (no Paymaster relayer
  // is wired), so honoring it here would fabricate "settled" transfers in
  // production. Flip this to a settler-availability check when a real
  // relayer lands.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "On-chain wallet transfers are not enabled on this deployment." },
      { status: 503 }
    );
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "wallets.transfer", { limit: 30, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const parsed = parse(TransferSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  // Scope the idempotency key per user so one client's key can't replay (or
  // conflict with) another account's request.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "wallets.transfer", () =>
    executeTransfer(req, account, parsed.data)
  , { principal: account.user.id, request: parsed.data });
}

type TransferInput = ReturnType<typeof TransferSchema.parse>;

async function executeTransfer(
  req: NextRequest,
  account: UserAccount,
  data: TransferInput
): Promise<NextResponse> {
  const { safeAddress, destination, amount, token, chain, signature, mfaCode, biometricProof, deviceSignals } = data;

  // `amount` is TOKEN units — it is what gets debited from the token balance
  // below, and it is what every client sends (web ScanToPay, native-app
  // useSend). Every gate underneath is denominated in USD, so the two must be
  // converted here rather than conflated: 5,000 EURC is not $5,000, and
  // treating it as such mis-scales the KYC cap, the velocity ceiling and the
  // step-up threshold for every token that is not 1:1 with the dollar.
  //
  // Only the LOOKUP moves up here — the funds check itself stays below the AML
  // screen, so a transfer to a sanctioned destination still produces its
  // compliance audit event rather than being turned away earlier as an
  // overdraw.
  //
  // The rate is derived from the user's own priced balance, never from a price
  // table on this route. An absent or unpriced balance falls back to par: for
  // the stablecoins TransferSchema accepts that is the right reading, and the
  // funds check below rejects the request anyway.
  const src = account.tokenBalances.find((b) => b.token === token && b.chain === chain);
  const unitUsd = src && src.amount > 0 && src.usdValue > 0 ? src.usdValue / src.amount : 1;
  const amountUsd = Math.round(amount * unitUsd * 100) / 100;

  // KYC-tier gate: per-transfer cap scales with verification level
  // (progressive access — see lib/kycTiers.ts).
  const tierCheck = checkTransferAmount(account.user.kycTier, amountUsd);
  if (!tierCheck.allowed) {
    audit("transfer.blocked", account.user.id, { destination, amount, reason: tierCheck.code });
    return NextResponse.json(
      { error: tierCheck.reason, code: tierCheck.code, kycTier: account.user.kycTier },
      { status: 403 }
    );
  }

  // Device intelligence: collect the device signals (fingerprint & behavioral)
  // before running the trust evaluation.
  const country = req.headers.get("x-vercel-ip-country");
  const ip = trustedClientIp(req);
  const hasFingerprint = deviceSignals && typeof deviceSignals === "object" && "visitorId" in deviceSignals;
  
  let deviceIntelResult;
  if (hasFingerprint) {
    deviceIntelResult = await analyzeDevice(deviceSignals as Record<string, unknown>, ip, country);
    if (deviceIntelResult.action === "block") {
      audit("transfer.blocked", account.user.id, {
        destination, amount, reason: deviceIntelResult.isLikelyAgent ? "ai_agent" : "device_intel", signals: deviceIntelResult.signals,
      });
      return NextResponse.json({ error: "Blocked by device intelligence", intel: deviceIntelResult }, { status: 403 });
    }
  }

  // Cross-instance velocity (Redis)
  const velocity = await checkVelocity({ userId: account.user.id, amountUsd, country });

  // Evaluate risk using the new Trust Layer
  const trustResult = evaluateTransferRisk({
    deviceSignals: deviceSignals as Record<string, unknown> | undefined,
    deviceIntelResult,
    velocityResult: velocity,
    ip,
    country,
    amountUsd,
    userId: account.user.id,
  });

  if (trustResult.action === "decline") {
    audit("transfer.blocked", account.user.id, { destination, amount, reason: "trust_layer", decision: trustResult.decision });
    return NextResponse.json({ error: "Transfer blocked by risk policy" }, { status: 403 });
  }

  if (trustResult.action === "hold") {
    audit("transfer.held", account.user.id, { destination, amount, reason: "trust_hold", decision: trustResult.decision });
    return NextResponse.json({ error: "Transfer held for review", held: true }, { status: 202 });
  }

  // Step-up MFA logic
  const stepUp = requiresStepUp({ action: "transfer", amountUsd });
  const needsStepUp = stepUp.required || trustResult.stepUpRequired || trustResult.action === "step_up" || trustResult.action === "manual_review";

  if (needsStepUp) {
    let stepUpPassed = false;
    if (biometricProof) {
      const bioCheck = await validateAndConsumeBiometricProof(account.user.id, biometricProof, {
        amount,
        asset: token,
        recipient: destination,
        chain,
      });
      if (bioCheck.valid) {
        stepUpPassed = true;
      } else {
        audit("auth.mfa_failed", account.user.id, { action: "transfer.biometric_failed", reason: bioCheck.reason });
        return NextResponse.json({ error: bioCheck.reason || "Invalid biometric proof", stepUpRequired: true }, { status: 401 });
      }
    }
    if (!stepUpPassed && !mfaCode) {
      return NextResponse.json(
        {
          error: stepUp.required
            ? stepUp.reason
            : "Additional verification required by trust policy",
          stepUpRequired: true,
          methods: ["biometric", ...stepUp.methods],
        },
        { status: 401 }
      );
    }
    if (!stepUpPassed && (!account.user.security.totpEnabled || !verifyTotp(account.user.security.totpSecret, mfaCode!))) {
      audit("auth.mfa_failed", account.user.id, { action: "transfer", amount });
      return NextResponse.json({ error: "Invalid or missing MFA code", stepUpRequired: true }, { status: 401 });
    }
  }

  // Verify the user-signed authorization before the Paymaster co-signs.
  // When the account has a verified linked wallet (EIP-191-proven device key),
  // the signature must recover to it; otherwise live mode fails closed and
  // only the demo path accepts a shape-validated blob (see lib/signature.ts).
  const owners =
    account.user.linkedWallet?.status === "active" ? [account.user.linkedWallet.address] : [];
  const sig = await verifyTransferSignature(
    signature,
    safeAddress || account.user.safeAddress,
    { destination, amount, token, chain },
    owners
  );
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  // AML gate: screen BOTH parties before the Paymaster co-signs.
  //
  // This screened only the destination. Sanctions are not directional — a
  // designated person sending money is exactly as prohibited as one receiving
  // it, and OFAC's own guidance is about dealing with the person at all, not
  // about which way the arrow points. services/payments.ts already screened
  // both parties (screenAddress on payer and recipient); this route did not,
  // so the same platform enforced two different rules depending on which
  // endpoint a user reached.
  //
  // The payer is the address that will actually be debited: the verified
  // linked wallet when there is one, otherwise the account's own reference.
  const payerAddress = account.user.linkedWallet?.address ?? safeAddress ?? account.user.safeAddress;
  const parties: { role: "payer" | "destination"; address: string }[] = [
    ...(payerAddress ? [{ role: "payer" as const, address: payerAddress }] : []),
    { role: "destination" as const, address: destination },
  ];

  // OFAC always; Circle Compliance too when configured (lib/compliance/
  // addressScreening.ts). A Circle "review" is not an allow: there is no
  // transfer review queue, so the transfer is refused with its own code.
  let screen = await screenAddressRisk(destination, chain);
  for (const party of parties) {
    const result = party.address === destination ? screen : await screenAddressRisk(party.address, chain);
    if (result.action === "review") {
      audit("transfer.blocked", account.user.id, { destination, amount, reason: "aml_review", party: party.role });
      return NextResponse.json({ error: "Transfer needs compliance review", code: "aml_review_required" }, { status: 409 });
    }
    if (result.action === "block") {
      audit("transfer.blocked", account.user.id, {
        destination,
        amount,
        reason: "aml_screen",
        party: party.role,
      });
      return NextResponse.json(
        // The response does not say WHICH side matched. Telling a payer that
        // they personally are the hit turns this endpoint into a sanctions
        // oracle; the audit event above records it for the compliance team.
        // No screen object either: it carries the matched address, which is
        // exactly the "which side" detail the comment above withholds.
        { error: "Transfer blocked by AML policy" },
        { status: 403 }
      );
    }
    if (party.role === "destination") screen = result;
  }

  // Funds check before anything is recorded — a transfer can't overdraw.
  // Compared in TOKEN units, against the token balance.
  if (!src || src.amount < amount) {
    return NextResponse.json(
      { error: `Insufficient ${token} balance on ${chain}.`, available: src?.amount ?? 0 },
      { status: 400 }
    );
  }

  // A REFERENCE, NOT A CHAIN HASH — and the `ftr_` prefix is the point.
  //
  // This used to be `"0x" + crypto.randomBytes(32)`, returned to the client as
  // `transactionHash`. No chain interaction happens on this path, so that value
  // was a 32-byte random number wearing the shape of a transaction hash: a user
  // could paste it into a block explorer and find nothing, and
  // /api/payments/[id]/receipt turns such a value into a clickable
  // `${chain.explorer}/tx/${hash}` link that 404s. The audit entry below recorded
  // it too, so an incident investigation would follow a hash that never existed.
  //
  // This is not a new judgement. /api/checkout/session carries a comment
  // recording that the identical pattern was removed from it for the identical
  // reason; this route was simply the surviving instance.
  //
  // The prefix makes the value self-describing, so no caller has to know the
  // difference — `ftr_…` cannot be mistaken for `0x…`, and nothing downstream can
  // accidentally build an explorer URL out of it.
  const reference = "ftr_" + crypto.randomBytes(16).toString("hex");

  // LEDGER FIRST. This ordering is the fix for a real inconsistency, not a style
  // preference, so it is worth stating why.
  //
  // recordMovement THROWS: LedgerDurabilityError when the deployment is
  // production without a durable ledger backend (lib/ledger.ts assertLedgerDurable),
  // and LedgerError on an unpostable amount. Previously it ran LAST — after the
  // balance had been debited (`src.amount -= amount`) and after a transaction had
  // been written to the user's history with `status: "settled"`.
  //
  // So a ledger outage produced the worst possible combination: the user's
  // balance was gone, their history said the transfer had settled, and the
  // double-entry books had no record of it at all. `credited != ledgered`, with
  // no compensating entry and nothing to reconcile against.
  //
  // Inverted, the failure mode becomes benign. If the ledger refuses, it refuses
  // BEFORE any balance moves and before anything claims to have settled — the
  // request fails and the user's money is untouched. The residual risk runs the
  // other way (a ledger entry whose presentational record is missing), and that
  // is strictly preferable: the books are correct and the view can be rebuilt
  // from them, whereas wrong books cannot be rebuilt from a correct view.
  //
  // The already-correct paths do it this way: webhooks/stripe, the two investing
  // settle routes, lib/services/account.ts and lib/services/payments.ts.
  const entry = await recordMovement("out", amountUsd, `Transfer ${token} to ${destination.slice(0, 10)}…`, account.user.id);

  recordTransaction(
    account.user.id,
    newTx({
      category: "transfer",
      direction: "out",
      title: `Sent ${token}`,
      subtitle: `${destination.slice(0, 10)}… · gas sponsored · ${chain}`,
      amountUsd,
      token,
      // TransferSchema accepts "tempo", but the shared `Chain` domain type
      // (@furlpay/types) does not list it, so it cannot be stored on a
      // Transaction. Narrowed here rather than widening `Chain`: that union is
      // used by the SDKs and the compliance package, and adding a member there
      // would assert tempo is supported everywhere those types reach. The
      // subtitle above still records the chain in text either way.
      ...(TX_CHAINS.includes(chain as (typeof TX_CHAINS)[number])
        ? { chain: chain as (typeof TX_CHAINS)[number] }
        : {}),
      status: "settled",
    })
  );

  // Deduct in token units, re-mark USD value at the balance's unit price so
  // non-USD tokens (e.g. EURC) keep their FX rate instead of collapsing to 1:1.
  src.amount -= amount;
  src.usdValue = Math.round(src.amount * unitUsd * 100) / 100;

  void commitVelocity({ userId: account.user.id, amountUsd, country });

  audit("transfer.executed", account.user.id, { destination, amount, amountUsd, token, chain, reference });

  // Fire-and-forget: the transfer is recorded and the ledger has moved; a
  // notification failure must neither slow nor fail it. Truncated address on
  // purpose — a push and an email are not places to print a full destination.
  void notifyTransaction(account, {
    kind: "transfer_out",
    amountUsd,
    counterparty: `${destination.slice(0, 10)}… (${chain})`,
    dateIso: new Date().toISOString(),
  });

  // `onChain: false` is explicit rather than implied by the absent
  // transactionHash. A caller that wants to show an explorer link needs a
  // positive signal that there is nothing to link to, not the absence of a
  // field it may not know to look for.
  return NextResponse.json({
    reference,
    onChain: false,
    gasSponsored: true,
    screen,
    ledgerTxId: entry.id,
  });
}
