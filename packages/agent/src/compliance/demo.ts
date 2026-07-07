import { ethers } from "ethers";
import "dotenv/config";
import { makeContext } from "./chain.js";
import { BuyerAgent } from "./buyerAgent.js";
import { SellerAgent } from "./sellerAgent.js";
import { ComplianceAgent } from "./complianceAgent.js";
import { runPurchase } from "./orchestrator.js";

// End-to-end demo of compliance-aware agentic payments, reproducing the two
// scenarios from arXiv 2605.00071 against the deployed on-chain guardrail:
//   Scenario I  — a compliant payment settles immediately (PASS attestation)
//   Scenario II — a payment over the source-of-funds threshold returns PENDING,
//                 is tranched (compliant part settles, remainder escrowed), and
//                 is released once a source-of-funds attestation is recorded.
//
// Env: RPC_URL, chain addresses (FURLPAY_* or a deployment record),
//      BUYER_PRIVATE_KEY, RELAYER_PRIVATE_KEY, ATTESTOR_PRIVATE_KEY, SELLER_ADDRESS.
//      ANTHROPIC_API_KEY enables Claude-authored mediation (optional).
// Run: npx tsx src/compliance/demo.ts

async function main() {
  const { provider, addresses } = makeContext();
  const chainId = Number((await provider.getNetwork()).chainId);
  const explorer = chainId === 42161 ? "https://arbiscan.io" : undefined;

  const buyerKey = process.env.BUYER_PRIVATE_KEY;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const attestorKey = process.env.ATTESTOR_PRIVATE_KEY || relayerKey;
  const sellerAddress = process.env.SELLER_ADDRESS;
  if (!buyerKey || !relayerKey || !sellerAddress) {
    throw new Error("Set BUYER_PRIVATE_KEY, RELAYER_PRIVATE_KEY and SELLER_ADDRESS");
  }

  const buyer = new BuyerAgent(buyerKey, provider);
  const seller = new SellerAgent(sellerAddress);
  // Reuse one signer instance when relayer and attestor share a key, so ethers
  // tracks the account's nonce across sequential txs (two Wallet objects for the
  // same address would race and reuse a nonce).
  const relayer = new ethers.Wallet(relayerKey, provider);
  const attestor = attestorKey === relayerKey ? relayer : new ethers.Wallet(attestorKey!, provider);
  const compliance = new ComplianceAgent(relayer, attestor, addresses, chainId);

  console.log(`Compliance-aware agentic payments demo — chainId ${chainId}`);
  console.log(`PolicyWrapper: ${addresses.policyWrapper}`);

  // Scenario I — small, compliant payment.
  await runPurchase({ buyer, seller, compliance, productId: "api-credits-small", addresses, chainId, explorer });

  // Scenario II — above the source-of-funds threshold → tranche + escrow.
  await runPurchase({ buyer, seller, compliance, productId: "api-credits-bulk", addresses, chainId, explorer });

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
