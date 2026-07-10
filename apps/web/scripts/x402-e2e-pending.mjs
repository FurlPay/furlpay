// Drives the settlement-timeout RECOVERY path (runbook §3a operational note):
// with interval mining OFF, the settler's waitForTransactionReceipt times out
// after the tx was submitted -> client gets 402 + pending{transaction,
// statusPath}; polling the status path returns 202 pending, then mining blocks
// upgrades it to settled/confirmed. Proves a timed-out payment is recoverable
// instead of silently lost.
//
// Prereqs: hardhat node (chainId 421614, NO interval mining) + MockUSDC
// deployed + next dev with the same env as x402-e2e-local.mjs.
//   node scripts/x402-e2e-pending.mjs      (takes ~3min: viem receipt timeout is 180s)
import { privateKeyToAccount } from "viem/accounts";

const APP = "http://localhost:3000";
const RPC = "http://127.0.0.1:8545";
const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CHAIN_ID = 421614;

const rpc = (method, params = []) =>
  fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  }).then((r) => r.json());

const payer = privateKeyToAccount(PAYER_KEY);
const url = `${APP}/api/x402/fx?from=USD&to=EUR&amount=100`;

// 1. quote
const r1 = await fetch(url);
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
const quote = await r1.json();
const req = quote.accepts.find((a) => a.extra.name === "USD Coin");
console.log("quote:", { quoteId: req.extra.quoteId, amount: req.maxAmountRequired });

// 2. sign + pay (mining disabled beyond automine -> settler times out at 180s)
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payer.address,
  to: req.payTo,
  value: req.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + 3600),
  nonce: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
};
const signature = await payer.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: CHAIN_ID, verifyingContract: req.asset },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});
const xPayment = Buffer.from(JSON.stringify({
  x402Version: quote.x402Version,
  scheme: "exact",
  network: req.network,
  payload: { signature, authorization },
  extra: { quoteId: req.extra.quoteId, binding: req.extra.binding, expiresAt: req.extra.expiresAt },
})).toString("base64");

console.log("paying (expect ~180s viem receipt timeout)...");
const t0 = Date.now();
const r2 = await fetch(url, { headers: { "X-PAYMENT": xPayment } });
const body = await r2.json();
console.log(`pay response after ${Math.round((Date.now() - t0) / 1000)}s:`, { status: r2.status, error: body.error, pending: body.pending });
if (r2.status !== 402 || !body.pending?.transaction) {
  throw new Error(`expected 402 + pending, got ${r2.status}: ${JSON.stringify(body)}`);
}

// 3. status poll while unconfirmed -> 202 pending
const statusUrl = `${APP}${body.pending.statusPath}`;
const s1 = await fetch(statusUrl);
console.log("status while pending:", { status: s1.status, body: await s1.json() });
if (s1.status !== 202) throw new Error(`expected 202 pending, got ${s1.status}`);

// 4. mine past the confirmation depth, poll again -> confirmed
for (let i = 0; i < 5; i++) await rpc("evm_mine");
const s2 = await fetch(statusUrl);
const s2body = await s2.json();
console.log("status after mining:", { status: s2.status, body: s2body });
if (s2.status !== 200 || !s2body.settled || s2body.settlement.status !== "confirmed") {
  throw new Error("expected settled/confirmed after mining");
}
console.log("PENDING-RECOVERY PATH VERIFIED: timeout -> 402+pending -> 202 poll -> confirmed");
