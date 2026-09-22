import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { requiresStepUp, verifyTotp } from "@furlpay/security";
import { evaluateTransferRisk } from "@/lib/trust/trustBridge";
import { newTx, recordTransaction, type UserAccount } from "@/lib/store";
import { verifyTransferSignature } from "@/lib/signature";
import { recordMovement } from "@/lib/ledger";
import { TransferSchema, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { checkVelocity, commitVelocity } from "@/lib/services/velocity";
import { analyzeDevice } from "@/lib/services/deviceIntel";
import { withIdempotency } from "@/lib/idempotency";
import { checkTransferAmount } from "@/lib/kycTiers";
import { notifyTransaction } from "@/lib/notify";

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
  , { principal: account.user.id });
}

type TransferInput = ReturnType<typeof TransferSchema.parse>;

async function executeTransfer(
  req: NextRequest,
  account: UserAccount,
  data: TransferInput
): Promise<NextResponse> {
  const { safeAddress, destination, amount, token, chain, signature, mfaCode, deviceSignals } = data;

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
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
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
    if (!mfaCode) {
      return NextResponse.json(
        {
          error: stepUp.required
            ? stepUp.reason
            : "Additional verification required by trust policy",
          stepUpRequired: true,
          methods: stepUp.methods,
        },
        { status: 401 }
      );
    }
    if (!account.user.security.totpEnabled || !verifyTotp(account.user.security.totpSecret, mfaCode)) {
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

  let screen = screenWallet(destination);
  for (const party of parties) {
    const result = screenWallet(party.address);
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
        { error: "Transfer blocked by AML policy", screen: result },
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

  const transactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  recordTransaction(
    account.user.id,
    newTx({
      category: "transfer",
      direction: "out",
      title: `Sent ${token}`,
      subtitle: `${destination.slice(0, 10)}… · gas sponsored · ${chain}`,
      amountUsd,
      token,
      chain,
      status: "settled",
    })
  );

  // Deduct in token units, re-mark USD value at the balance's unit price so
  // non-USD tokens (e.g. EURC) keep their FX rate instead of collapsing to 1:1.
  src.amount -= amount;
  src.usdValue = Math.round(src.amount * unitUsd * 100) / 100;

  // Double-entry: funds leave user cash.
  const entry = await recordMovement("out", amountUsd, `Transfer ${token} to ${destination.slice(0, 10)}…`, account.user.id);

  void commitVelocity({ userId: account.user.id, amountUsd, country });

  audit("transfer.executed", account.user.id, { destination, amount, amountUsd, token, chain, transactionHash });

  // Fire-and-forget: the transfer is recorded and the ledger has moved; a
  // notification failure must neither slow nor fail it. Truncated address on
  // purpose — a push and an email are not places to print a full destination.
  void notifyTransaction(account, {
    kind: "transfer_out",
    amountUsd,
    counterparty: `${destination.slice(0, 10)}… (${chain})`,
    dateIso: new Date().toISOString(),
  });

  return NextResponse.json({ transactionHash, gasSponsored: true, screen, ledgerTxId: entry.id });
}
