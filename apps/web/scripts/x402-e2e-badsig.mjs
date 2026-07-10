// Negative test: a corrupted EIP-3009 signature must be rejected (402), even
// though ECDSA failure now falls through to the ERC-1271 on-chain check.
import { privateKeyToAccount } from "viem/accounts";

const APP = "http://localhost:3000";
const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const payer = privateKeyToAccount(PAYER_KEY);
const url = `${APP}/api/x402/fx?from=USD&to=EUR&amount=100`;

const quote = await (await fetch(url)).json();
const req = quote.accepts.find((a) => a.extra.name === "USD Coin");
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: payer.address, to: req.payTo, value: req.maxAmountRequired,
  validAfter: String(now - 60), validBefore: String(now + 3600),
  nonce: `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`,
};
const sig = await payer.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId: 421614, verifyingContract: req.asset },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ] },
  primaryType: "TransferWithAuthorization",
  message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
});
// Corrupt one byte of r.
const badSig = sig.slice(0, 10) + (sig[10] === "0" ? "1" : "0") + sig.slice(11);
const xPayment = Buffer.from(JSON.stringify({
  x402Version: quote.x402Version, scheme: "exact", network: req.network,
  payload: { signature: badSig, authorization },
  extra: { quoteId: req.extra.quoteId, binding: req.extra.binding, expiresAt: req.extra.expiresAt },
})).toString("base64");
const r = await fetch(url, { headers: { "X-PAYMENT": xPayment } });
const body = await r.json();
console.log({ status: r.status, error: body.error });
if (r.status === 200) throw new Error("SECURITY FAILURE: tampered signature accepted");
console.log("tampered signature correctly rejected");
