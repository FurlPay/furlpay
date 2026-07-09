import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { assessRisk, requiresStepUp, verifyTotp } from "@furlpay/security";
import { newTx, recordTransaction } from "@/lib/store";
import { verifyTransferSignature } from "@/lib/signature";
import { recordMovement } from "@/lib/ledger";
import { TransferSchema, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { checkVelocity, commitVelocity } from "@/lib/services/velocity";

// POST /api/wallets/transfer — gas-sponsored L2 stablecoin transfer via
// Paymaster, from the SESSION user's balances.
// body: { safeAddress, destination, amount, token, chain, signature, mfaCode?, deviceSignals? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "wallets.transfer", { limit: 30, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const parsed = parse(TransferSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { safeAddress, destination, amount, token, chain, signature, mfaCode, deviceSignals } = parsed.data;

  // Device / behavioral risk gate (Sardine-style).
  const risk = assessRisk(deviceSignals || {});
  if (risk.action === "block") {
    audit("transfer.blocked", account.user.id, { destination, amount, reason: "risk_engine" });
    return NextResponse.json({ error: "Blocked by risk engine", risk }, { status: 403 });
  }

  // Cross-instance velocity (Redis): burst caps, daily USD volume, and
  // impossible travel via the CDN's IP-country header. Burst → hard block;
  // volume/geo anomalies escalate to step-up MFA below.
  const country = req.headers.get("x-vercel-ip-country");
  const velocity = await checkVelocity({ userId: account.user.id, amountUsd: amount, country });
  if (velocity.action === "block") {
    audit("transfer.blocked", account.user.id, { destination, amount, reason: "velocity", flags: velocity.flags });
    return NextResponse.json({ error: "Transfer blocked by velocity policy", velocity }, { status: 429 });
  }

  // Step-up MFA for high-value transfers (>= $5000) or velocity anomalies.
  const stepUp = requiresStepUp({ action: "transfer", amountUsd: amount });
  if (stepUp.required || velocity.action === "review") {
    if (!mfaCode) {
      return NextResponse.json(
        {
          error: stepUp.required ? stepUp.reason : `Additional verification required: ${velocity.reasons.join("; ")}`,
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
  const sig = verifyTransferSignature(signature, safeAddress || account.user.safeAddress, {
    destination, amount, token, chain,
  });
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  // AML gate: screen the destination before the Paymaster co-signs.
  const screen = screenWallet(destination);
  if (screen.action === "block") {
    audit("transfer.blocked", account.user.id, { destination, amount, reason: "aml_screen" });
    return NextResponse.json(
      { error: "Transfer blocked by AML policy", screen },
      { status: 403 }
    );
  }

  // Funds check before anything is recorded — a transfer can't overdraw.
  const src = account.tokenBalances.find((b) => b.token === token && b.chain === chain);
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
      amountUsd: amount,
      token,
      chain,
      status: "settled",
    })
  );

  // Deduct in token units, re-mark USD value at the balance's unit price so
  // non-USD tokens (e.g. EURC) keep their FX rate instead of collapsing to 1:1.
  const unitUsd = src.amount > 0 ? src.usdValue / src.amount : 1;
  src.amount -= amount;
  src.usdValue = Math.round(src.amount * unitUsd * 100) / 100;

  // Double-entry: funds leave user cash.
  const entry = recordMovement("out", amount, `Transfer ${token} to ${destination.slice(0, 10)}…`, account.user.id);

  void commitVelocity({ userId: account.user.id, amountUsd: amount, country });

  audit("transfer.executed", account.user.id, { destination, amount, token, chain, transactionHash });
  return NextResponse.json({ transactionHash, gasSponsored: true, screen, ledgerTxId: entry.id });
}
