import { ethers } from "ethers";
import { createHash } from "node:crypto";
import type { BuyerAgent } from "./buyerAgent.js";
import type { SellerAgent } from "./sellerAgent.js";
import type { ComplianceAgent } from "./complianceAgent.js";
import type { Addresses } from "./chain.js";

// Orchestrator — wires the buyer, seller and compliance agents into one
// end-to-end purchase, reproducing the paper's mediated flow. The compliance
// agent coordinates evaluation, settlement, and (for PENDING) tranching +
// source-of-funds resolution.

export interface RunOptions {
  buyer: BuyerAgent;
  seller: SellerAgent;
  compliance: ComplianceAgent;
  productId: string;
  addresses: Addresses;
  chainId: number;
  explorer?: string; // e.g. https://arbiscan.io
}

function link(explorer: string | undefined, hash: string): string {
  return explorer ? `${explorer}/tx/${hash}` : hash;
}

export async function runPurchase(opts: RunOptions): Promise<void> {
  const { buyer, seller, compliance, addresses, chainId, explorer } = opts;
  const quote = seller.quote(opts.productId);
  const txId = ethers.hexlify(ethers.randomBytes(32));

  console.log(`\n── Purchase: ${quote.description} — ${quote.amountUsdc} USDC ──`);
  console.log(`   buyer:     ${buyer.address}`);
  console.log(`   recipient: ${quote.recipient}`);
  console.log(`   txId:      ${txId}`);

  // 1) Non-interactive compliance check (read-only).
  const evalResult = await compliance.evaluate(buyer.address, quote.recipient, quote.amountAtomic, txId);
  console.log(`\n   Policy evaluation → ${evalResult.outcome}${evalResult.reason ? ` (${evalResult.reason})` : ""}`);

  // 2) Claude-mediated explanation.
  const explanation = await compliance.explain({
    outcome: evalResult.outcome,
    reason: evalResult.reason,
    amountUsdc: quote.amountUsdc,
    product: quote.description,
  });
  console.log(`   Mediator: ${explanation}`);

  // 3) Act on the outcome.
  if (evalResult.outcome === "PASS" || evalResult.outcome === "FAIL") {
    const auth = await buyer.authorize(addresses.usdc, quote.recipient, quote.amountAtomic, chainId);
    const res = await compliance.settle(buyer.address, quote.recipient, auth, quote.resource, txId);
    const att = await compliance.attestation(txId);
    console.log(`   Settlement tx: ${link(explorer, res.txHash)}`);
    console.log(`   On-chain attestation: ${att.outcome}${att.reason ? ` (${att.reason})` : ""}`);
    return;
  }

  // PENDING → tranche + escrow + source-of-funds resolution.
  const { compliant, remainder } = compliance.splitAtThreshold(quote.amountAtomic);
  console.log(
    `\n   Proposing tranche: ${ethers.formatUnits(compliant, 6)} USDC settles now, ` +
      `${ethers.formatUnits(remainder, 6)} USDC escrowed pending source-of-funds.`,
  );
  const compliantAuth = await buyer.authorize(addresses.usdc, quote.recipient, compliant, chainId);
  const escrowAuth = await buyer.authorize(addresses.usdc, addresses.complianceEscrow, remainder, chainId);
  const releaseDeadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

  const trancheRes = await compliance.tranche(
    buyer.address,
    quote.recipient,
    compliantAuth,
    escrowAuth,
    quote.resource,
    txId,
    releaseDeadline,
  );
  console.log(`   Tranche tx: ${link(explorer, trancheRes.txHash)}`);

  // Buyer submits source-of-funds evidence; the operator records its hash on-chain.
  const evidence = {
    subject: buyer.address.toLowerCase(),
    evidenceType: "bank-statement",
    documentRef: `sof://demo/${buyer.address}`,
    declaredAmount: remainder.toString(),
    collectedAt: new Date().toISOString(),
  };
  const evidenceHash = "0x" + createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const sofRes = await compliance.recordSoF(buyer.address, evidenceHash, expiry);
  console.log(`   Source-of-funds attestation tx: ${link(explorer, sofRes.txHash)}`);

  const releaseRes = await compliance.release(txId);
  const finalAtt = await compliance.attestation(txId);
  console.log(`   Escrow release tx: ${link(explorer, releaseRes.txHash)}`);
  console.log(`   Final on-chain attestation: ${finalAtt.outcome}${finalAtt.reason ? ` (${finalAtt.reason})` : ""}`);
}
