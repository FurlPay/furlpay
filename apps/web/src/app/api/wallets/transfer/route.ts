import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { assessRisk, requiresStepUp, verifyTotp } from "@furlpay/security";
import { db, newTx, recordTransaction } from "@/lib/store";
import { verifyTransferSignature } from "@/lib/signature";
import { recordMovement } from "@/lib/ledger";
import { TransferSchema, parse } from "@/lib/schemas";

// POST /api/wallets/transfer — gas-sponsored L2 stablecoin transfer via Paymaster.
// body: { safeAddress, destination, amount, token, chain, signature, mfaCode?, deviceSignals? }
export async function POST(req: NextRequest) {
  const parsed = parse(TransferSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { safeAddress, destination, amount, token, chain, signature, mfaCode, deviceSignals } = parsed.data;

  // Device / behavioral risk gate (Sardine-style).
  const risk = assessRisk(deviceSignals || {});
  if (risk.action === "block") {
    return NextResponse.json({ error: "Blocked by risk engine", risk }, { status: 403 });
  }

  // Step-up MFA for high-value transfers (>= $5000).
  const stepUp = requiresStepUp({ action: "transfer", amountUsd: amount });
  if (stepUp.required) {
    if (!mfaCode) {
      return NextResponse.json({ error: stepUp.reason, stepUpRequired: true, methods: stepUp.methods }, { status: 401 });
    }
    if (!db.user.security.totpEnabled || !verifyTotp(db.user.security.totpSecret, mfaCode)) {
      return NextResponse.json({ error: "Invalid or missing MFA code", stepUpRequired: true }, { status: 401 });
    }
  }

  // Verify the user-signed authorization before the Paymaster co-signs.
  const sig = verifyTransferSignature(signature, safeAddress || db.user.safeAddress, {
    destination, amount, token, chain,
  });
  if (!sig.ok) {
    return NextResponse.json({ error: sig.reason }, { status: 401 });
  }

  // AML gate: screen the destination before the Paymaster co-signs.
  const screen = screenWallet(destination);
  if (screen.action === "block") {
    return NextResponse.json(
      { error: "Transfer blocked by AML policy", screen },
      { status: 403 }
    );
  }

  const transactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  recordTransaction(
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

  const src = db.tokenBalances.find((b) => b.token === token && b.chain === chain);
  if (src) {
    src.amount = Math.max(0, src.amount - amount);
    src.usdValue = src.amount;
  }

  // Double-entry: funds leave user cash.
  const entry = recordMovement("out", amount, `Transfer ${token} to ${destination.slice(0, 10)}…`);

  return NextResponse.json({ transactionHash, gasSponsored: true, screen, ledgerTxId: entry.id });
}
