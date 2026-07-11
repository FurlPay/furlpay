// Verifies live Li.Fi integration with real credentials (no funds move):
//   1. POST /api/swaps           -> live quote, source must be "lifi" (fee-
//      enabled integrator accepted; a rejected fee would 4xx -> mock fallback)
//   2. POST /api/swaps/execute   -> real transactionRequest from Li.Fi for a
//      same-chain USDC->USDT swap on Arbitrum (unsigned; user's wallet signs)
// Run against `next dev` with ALLOW_GUEST_LOGIN=1 + real LIFI_* env.
//   node scripts/lifi-verify-local.mjs
const APP = process.env.E2E_APP || "http://localhost:3000";
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const login = await fetch(`${APP}/api/auth/guest`, { method: "POST" });
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const H = { "content-type": "application/json", cookie };

// 1. live quote with integrator fee
const r1 = await fetch(`${APP}/api/swaps`, {
  method: "POST", headers: H,
  body: JSON.stringify({ fromToken: "USDC", toToken: "USDT", fromChain: "arbitrum", toChain: "arbitrum", amountIn: 100 }),
});
const { quote } = await r1.json();
check("quote returned", r1.status === 200 && !!quote, `status ${r1.status}`);
check("priced by live Li.Fi (fee-enabled integrator accepted)", quote?.source === "lifi", `source=${quote?.source}`);
console.log("  quote:", { amountOut: quote?.amountOut, feeUsd: quote?.feeUsd, gasUsd: quote?.gasUsd, route: quote?.route?.[0] });

// Fee assertion goes to the raw API (feeCosts reporting varies per routing
// tool, so the app-level feeUsd is not a reliable oracle): with integrator=
// furlpay & fee=0.005 the quote must carry a ~0.75% included fee line
// (our 0.5% + Li.Fi's 0.25% share).
if (process.env.LIFI_API_KEY) {
  const qs = new URLSearchParams({
    fromChain: "42161", toChain: "42161",
    fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    toToken: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    fromAmount: "100000000",
    fromAddress: "0x70457D89606b5B757104D15C3c87aa5e3CEea31e",
    slippage: "0.0005", integrator: process.env.LIFI_INTEGRATOR || "furlpay", fee: process.env.LIFI_FEE || "0.005",
  });
  const raw = await fetch(`https://li.quest/v1/quote?${qs}`, { headers: { "x-lifi-api-key": process.env.LIFI_API_KEY } });
  const rq = await raw.json();
  const feeLine = (rq?.estimate?.feeCosts ?? []).find((c) => Number(c.percentage) > 0.004);
  check("integrator fee applied on raw quote (~0.75% incl. Li.Fi share)", raw.status === 200 && !!feeLine, feeLine ? `${feeLine.name} ${feeLine.percentage} ($${feeLine.amountUsd})` : `status ${raw.status}, feeCosts=${JSON.stringify(rq?.estimate?.feeCosts)}`);
} else {
  console.log("  (skip raw fee assertion — LIFI_API_KEY not in this shell)");
}

// 2. executable transactionRequest (real wallet address, no submission)
const FROM = "0x70457D89606b5B757104D15C3c87aa5e3CEea31e"; // furlpay fee wallet (any funded-look address works for quoting)
const r2 = await fetch(`${APP}/api/swaps/execute`, {
  method: "POST", headers: H,
  body: JSON.stringify({ fromToken: "USDC", toToken: "USDT", fromChain: "arbitrum", toChain: "arbitrum", amountIn: 100, fromAddress: FROM }),
});
const body = await r2.json();
check("execute returned a route", r2.status === 200 && body.ok, `status ${r2.status}: ${body.error ?? ""}`);
const tx = body.transactionRequest;
check("transactionRequest present", !!tx?.to && !!tx?.data && tx?.chainId === 42161, JSON.stringify({ to: tx?.to, chainId: tx?.chainId, dataLen: tx?.data?.length }));
check("approvalAddress present (ERC-20 send)", /^0x[0-9a-fA-F]{40}$/.test(body.approvalAddress ?? ""), body.approvalAddress ?? "null");
console.log("  execution:", { to: tx?.to, chainId: tx?.chainId, value: tx?.value, gasLimit: tx?.gasLimit, approval: body.approvalAddress, amountOut: body.quote?.amountOut });

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("LI.FI LIVE INTEGRATION VERIFIED (fee-enabled quotes + executable route)");
