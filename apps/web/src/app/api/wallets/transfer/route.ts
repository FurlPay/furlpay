import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { db, newTx, recordTransaction } from "@/lib/store";
import { verifyTransferSignature } from "@/lib/signature";

// POST /api/wallets/transfer — gas-sponsored L2 stablecoin transfer via Paymaster.
// body: { safeAddress, destination, amount, token, chain, signature }
export async function POST(req: NextRequest) {
  const { safeAddress, destination, amount, token, chain, signature } = await req.json();

  if (!destination || !amount || !signature) {
    return NextResponse.json({ error: "destination, amount, signature required" }, { status: 400 });
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

  return NextResponse.json({ transactionHash, gasSponsored: true, screen });
}
