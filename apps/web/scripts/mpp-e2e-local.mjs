// Drives the full MPP (Machine Payments Protocol) cycle against the same local
// stack as x402-e2e-local.mjs (hardhat node chainId 421614 + MockUSDC + next
// dev with X402_ENFORCE_SIGNATURE=1):
//   1. GET /api/mpp/fx                       -> 402 + WWW-Authenticate: Payment
//   2. parse challenge, sign EIP-3009 authorization
//   3. retry with Authorization: Payment <b64url credential>
//      -> 200 + Payment-Receipt
//   4. read MockUSDC balances                -> money actually moved
//   5. replay                                -> 402 invalid-challenge/verification-failed
//
//   node scripts/mpp-e2e-local.mjs
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const APP = process.env.E2E_APP || "http://localhost:3000";
const RPC = process.env.E2E_RPC || "http://127.0.0.1:8545";
const PAYER_KEY = process.env.E2E_PAYER_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TREASURY = process.env.E2E_TREASURY || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const USDC = process.env.E2E_USDC || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CHAIN_ID = Number(process.env.E2E_CHAIN_ID || 421614);

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64urlEncode = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Parse a `WWW-Authenticate: Payment k="v", k2="v2"` header into a map.
function parseChallenge(header) {
  const body = header.replace(/^Payment\s+/i, "");
  const out = {};
  for (const m of body.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const pub = createPublicClient({ transport: http(RPC) });
const payer = privateKeyToAccount(PAYER_KEY);
const bal = async (a) => formatUnits(await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [a] }), 6);

const before = { payer: await bal(payer.address), treasury: await bal(TREASURY) };

// 1. unpaid -> 402 challenge
const url = `${APP}/api/mpp/fx?from=USD&to=EUR&amount=100`;
const r1 = await fetch(url);
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
const wa = r1.headers.get("www-authenticate");
if (!wa) throw new Error("no WWW-Authenticate header");
const ch = parseChallenge(wa);
const request = JSON.parse(b64urlDecode(ch.request).toString("utf8"));
console.log("MPP challenge:", { method: ch.method, intent: ch.intent, id: ch.id.slice(0, 12) + "…", amount: request.maxAmountRequired, asset: request.asset, network: request.network });

// 2. sign the EIP-3009 authorization for the quoted atomic amount
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payer.address,
  to: request.recipient,
  value: request.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + 300),
  nonce: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
};
const signature = await payer.signTypedData({
  domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: request.asset },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});

// 3. build the credential and pay
const credential = b64urlEncode(JSON.stringify({
  challenge: { id: ch.id, realm: ch.realm, method: ch.method, intent: ch.intent, request: ch.request, expires: ch.expires },
  source: "did:example:mpp-e2e",
  payload: { signature, authorization },
}));
const r2 = await fetch(url, { headers: { Authorization: `Payment ${credential}` } });
const body = await r2.json();
if (r2.status !== 200 || !body.paid) throw new Error(`payment failed (${r2.status}): ${JSON.stringify(body)}`);
const receipt = JSON.parse(b64urlDecode(r2.headers.get("payment-receipt")).toString("utf8"));
console.log("paid:", { status: r2.status, payer: body.payer, rate: body.quote?.midMarketRate });
console.log("Payment-Receipt:", receipt);

// 4. prove money moved on-chain
const tx = await pub.getTransactionReceipt({ hash: receipt.reference });
const after = { payer: await bal(payer.address), treasury: await bal(TREASURY) };
console.log("on-chain tx:", { hash: receipt.reference, block: Number(tx.blockNumber), status: tx.status });
console.log("USDC balances:", { before, after });

// 5. replay must be rejected
const r3 = await fetch(url, { headers: { Authorization: `Payment ${credential}` } });
const p3 = await r3.json();
console.log("replay attempt:", { status: r3.status, problem: p3.type?.split("/").pop(), detail: p3.detail });
if (r3.status === 200) throw new Error("SECURITY FAILURE: replay accepted");
console.log("MPP E2E VERIFIED: 402 challenge -> EIP-3009 -> on-chain settle -> receipt -> replay rejected");
