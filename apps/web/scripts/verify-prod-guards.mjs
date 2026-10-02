// Verifies the production mock-settlement guards (audit fix, Jul 2026):
// against a `next start` (NODE_ENV=production) instance, with a real session
// cookie (FURLPAY_PROBE_COOKIE), the three demo-ledger money routes must refuse to
// fabricate settlement (503) while their quote paths keep working.
//   node scripts/verify-prod-guards.mjs [baseUrl]
const APP = process.argv[2] || "http://localhost:3100";
let failures = 0;

const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

// A real session is needed to get PAST auth to the guards. Guest login used to
// provide one, but production now refuses guest login whatever ALLOW_GUEST_LOGIN
// says (lib/__tests__/productionAuth.spec.ts), so against a correct production
// build that path can only 403. Pass a staging session instead:
//   FURLPAY_PROBE_COOKIE="furlpay_session=..." node scripts/verify-prod-guards.mjs https://staging...
const cookie = (process.env.FURLPAY_PROBE_COOKIE ?? "").trim();
if (!cookie.startsWith("furlpay_session=")) {
  console.error("FURLPAY_PROBE_COOKIE (a real furlpay_session cookie) is required; guest login is disabled in production.");
  process.exit(2);
}
const me = await fetch(`${APP}/api/profile`, { headers: { cookie } });
check("probe session is valid", me.ok, `status ${me.status}`);
const authed = { "content-type": "application/json", cookie };

// 1. wallets/transfer: must 503 before doing anything (guard precedes auth).
const t = await fetch(`${APP}/api/wallets/transfer`, { method: "POST", headers: authed, body: JSON.stringify({}) });
check("wallets/transfer refuses in prod", t.status === 503, `status ${t.status}: ${(await t.json()).error ?? ""}`);

// 2. swaps: quote OK, execute 503.
const sq = await fetch(`${APP}/api/swaps`, {
  method: "POST", headers: authed,
  body: JSON.stringify({ fromToken: "USDT", toToken: "USDC", fromChain: "arbitrum", amountIn: 100 }),
});
check("swaps quote still available", sq.status === 200, `status ${sq.status}`);
const sx = await fetch(`${APP}/api/swaps`, {
  method: "POST", headers: authed,
  body: JSON.stringify({ fromToken: "USDT", toToken: "USDC", fromChain: "arbitrum", amountIn: 100, execute: true }),
});
check("swaps execute refuses in prod", sx.status === 503, `status ${sx.status}`);

// 3. offramp: quote OK, execute 503.
const oq = await fetch(`${APP}/api/offramp`, {
  method: "POST", headers: authed,
  body: JSON.stringify({ fromCurrency: "USD", toCurrency: "EUR", amount: 100 }),
});
check("offramp quote still available", oq.status === 200, `status ${oq.status}`);
const ox = await fetch(`${APP}/api/offramp`, {
  method: "POST", headers: authed,
  body: JSON.stringify({ fromCurrency: "USD", toCurrency: "EUR", amount: 100, execute: true }),
});
check("offramp execute refuses in prod", ox.status === 503, `status ${ox.status}`);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("ALL PROD GUARDS VERIFIED");
