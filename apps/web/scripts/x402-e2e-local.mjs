// Drives the full x402 live-settlement cycle against a local stack:
//   hardhat node (chainId 421614) + MockUSDC + next dev with
//   X402_ENFORCE_SIGNATURE=1 (see docs/GO-LIVE-MONEY.md §3).
//
//   1. GET /api/x402/fx                        -> 402 + quote
//   2. sign EIP-3009 transferWithAuthorization  (payer key, EIP-712)
//   3. GET again with X-PAYMENT                -> 200 + on-chain settlement
//   4. read MockUSDC balances                  -> money actually moved
//
//   node scripts/x402-e2e-local.mjs
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const APP = "http://localhost:3000";
const RPC = "http://127.0.0.1:8545";
// Hardhat well-known test accounts (never used on real networks).
const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TREASURY = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const USDC = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CHAIN_ID = 421614;

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const pub = createPublicClient({ transport: http(RPC) });
const payer = privateKeyToAccount(PAYER_KEY);

const bal = async (addr) =>
  formatUnits(await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [addr] }), 6);

const before = { payer: await bal(payer.address), treasury: await bal(TREASURY) };

// 1. unpaid request -> 402 quote
const url = `${APP}/api/x402/fx?from=USD&to=EUR&amount=100`;
const r1 = await fetch(url);
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}: ${await r1.text()}`);
const quote = await r1.json();
const req = quote.accepts.find((a) => a.extra.name === "USD Coin");
console.log("402 quote:", {
  network: req.network, asset: req.asset, amount: req.maxAmountRequired, payTo: req.payTo, quoteId: req.extra.quoteId,
});

// 2. sign the EIP-3009 authorization (exactly what a paying agent does)
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payer.address,
  to: req.payTo,
  value: req.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + req.maxTimeoutSeconds),
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
  message: {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

// 3. pay
const xPayment = Buffer.from(JSON.stringify({
  x402Version: quote.x402Version,
  scheme: "exact",
  network: req.network,
  payload: { signature, authorization },
  extra: { quoteId: req.extra.quoteId, binding: req.extra.binding, expiresAt: req.extra.expiresAt },
})).toString("base64");

const r2 = await fetch(url, { headers: { "X-PAYMENT": xPayment } });
const body = await r2.json();
if (r2.status !== 200 || !body.paid) throw new Error(`payment failed (${r2.status}): ${JSON.stringify(body)}`);
const receipt = JSON.parse(Buffer.from(r2.headers.get("x-payment-response"), "base64").toString("utf8"));
console.log("paid response:", { status: r2.status, payer: body.payer, fx: body.quote?.rate ?? body.quote });
console.log("settlement receipt:", receipt);

// 4. prove the money moved on-chain
const tx = await pub.getTransactionReceipt({ hash: receipt.transaction });
const after = { payer: await bal(payer.address), treasury: await bal(TREASURY) };
console.log("on-chain tx:", { hash: receipt.transaction, block: Number(tx.blockNumber), status: tx.status, gasPaidBy: tx.from });
console.log("USDC balances:", { before, after });

// 5. replay must be rejected (nonce + quote single-use)
const r3 = await fetch(url, { headers: { "X-PAYMENT": xPayment } });
console.log("replay attempt:", { status: r3.status, error: (await r3.json()).error });
