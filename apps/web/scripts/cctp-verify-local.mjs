// Verifies the CCTP V2 execution surface without moving funds:
//   1. POST /api/intents/cctp action=burn -> unsigned approve+depositForBurn
//   2. decode both calldata blobs with viem against the V2 ABIs and assert
//      every field (amount, domain, bytes32 recipient, burnToken, maxFee,
//      finality threshold)
//   3. GET /api/intents/cctp/attestation -> proves the live Iris API path
//      (unknown tx hash -> status "pending")
//   4. action=mint -> decodes to receiveMessage(message, attestation)
// Run against `next dev` with ALLOW_GUEST_LOGIN=1:  node scripts/cctp-verify-local.mjs
import { decodeFunctionData, parseAbi, pad } from "viem";

const APP = process.env.E2E_APP || "http://localhost:3000";
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const login = await fetch(`${APP}/api/auth/guest`, { method: "POST" });
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const H = { "content-type": "application/json", cookie };

// 1. burn bundle
const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const r1 = await fetch(`${APP}/api/intents/cctp`, {
  method: "POST", headers: H,
  body: JSON.stringify({ action: "burn", sourceChain: "arbitrum", destinationChain: "base", amount: 25.5, recipient: RECIPIENT, fast: true }),
});
const { bundle } = await r1.json();
check("burn bundle returned", r1.status === 200 && bundle?.transactions?.length === 2, `status ${r1.status}`);

// 2. decode approve
const approveAbi = parseAbi(["function approve(address spender, uint256 value)"]);
const messengerAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);
const [approveTx, burnTx] = bundle.transactions;
const approve = decodeFunctionData({ abi: approveAbi, data: approveTx.data });
check("approve target is Arbitrum native USDC", approveTx.to.toLowerCase() === "0xaf88d065e77c8cc2239327c5edb3a432268e5831");
check("approve spender is TokenMessengerV2", approve.args[0].toLowerCase() === "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
check("approve amount = 25.5 USDC atomic", approve.args[1] === 25_500_000n, String(approve.args[1]));

// 3. decode depositForBurn
const burn = decodeFunctionData({ abi: messengerAbi, data: burnTx.data });
const [amount, domain, mintRecipient, burnToken, destCaller, maxFee, threshold] = burn.args;
check("burn tx targets TokenMessengerV2", burnTx.to.toLowerCase() === "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
check("depositForBurn amount", amount === 25_500_000n, String(amount));
check("destination domain = base (6)", domain === 6, String(domain));
check("mintRecipient = bytes32(recipient)", mintRecipient.toLowerCase() === pad(RECIPIENT, { size: 32 }).toLowerCase());
check("burnToken = Arbitrum USDC", burnToken.toLowerCase() === "0xaf88d065e77c8cc2239327c5edb3a432268e5831");
check("destinationCaller = 0 (anyone mints)", /^0x0{64}$/.test(destCaller));
check("maxFee = 1bp (fast)", maxFee === 2550n, String(maxFee));
check("minFinalityThreshold = 1000 (fast)", threshold === 1000, String(threshold));

// standard mode: zero fee, threshold 2000
const r2 = await fetch(`${APP}/api/intents/cctp`, {
  method: "POST", headers: H,
  body: JSON.stringify({ action: "burn", sourceChain: "arbitrum", destinationChain: "base", amount: 25.5, recipient: RECIPIENT, fast: false }),
});
const std = decodeFunctionData({ abi: messengerAbi, data: (await r2.json()).bundle.transactions[1].data });
check("standard: maxFee = 0", std.args[5] === 0n);
check("standard: threshold = 2000", std.args[6] === 2000);

// 4. live Iris poll (unknown hash -> pending; proves API shape + reachability)
const fakeTx = "0x" + "ab".repeat(32);
const r3 = await fetch(`${APP}/api/intents/cctp/attestation?sourceDomain=3&txHash=${fakeTx}`, { headers: H });
const att = await r3.json();
check("Iris attestation poll (live API)", r3.status === 200 && att.status === "pending", `status ${r3.status}: ${JSON.stringify(att)}`);

// 5. mint calldata
const r4 = await fetch(`${APP}/api/intents/cctp`, {
  method: "POST", headers: H,
  body: JSON.stringify({ action: "mint", message: "0x" + "11".repeat(100), attestation: "0x" + "22".repeat(65) }),
});
const { transaction } = await r4.json();
const transmitterAbi = parseAbi(["function receiveMessage(bytes message, bytes attestation)"]);
const mint = decodeFunctionData({ abi: transmitterAbi, data: transaction.data });
check("mint targets MessageTransmitterV2", transaction.to.toLowerCase() === "0x81d40f21f12a8f0e3252bccb954d722d4c464b64");
check("receiveMessage args round-trip", mint.args[0] === "0x" + "11".repeat(100) && mint.args[1] === "0x" + "22".repeat(65));

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("CCTP V2 EXECUTION SURFACE VERIFIED (calldata + live Iris)");
