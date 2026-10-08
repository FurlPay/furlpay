#!/usr/bin/env node
// Post-deploy smoke test: read-only requests against production (or
// SMOKE_BASE_URL). Exits non-zero when anything a user depends on is down.
// Sends no credentials and triggers no side effects (no OTP, no email, no
// payment): every probe is a GET that only reads.
//
//   npm run smoke:prod            # https://furlpay.com
//   SMOKE_BASE_URL=https://web-xyz.vercel.app npm run smoke:prod

const base = (process.env.SMOKE_BASE_URL ?? "https://furlpay.com").replace(/\/+$/, "");

/** [path, what must hold, required?] — "required" failures fail the run. */
const PROBES = [
  ["/api/health", (s) => s === 200, true, "liveness"],
  ["/api/health/ready", (s) => s === 200, true, "readiness: KV write + database"],
  ["/api/auth/passkey/authenticate", (s) => s === 200, true, "sign-in can start (passkey challenge)"],
  ["/api/rails", (s) => s === 200, true, "rail operational controls readable"],
  ["/api/x402/fx", (s) => s === 200, false, "x402 FX quote"],
  ["/onchain", (s) => s === 200, true, "dashboard page"],
  ["/api/onchain/token/usdc/metrics", (s, b) => s === 200 && b?.data?.available === true, false, "USDC index read model (needs migration 0036)"],
  ["/api/onchain/cctp", (s, b) => s === 200 && b?.data?.available === true, false, "CCTP index (needs 0034/0035)"],
];

let failed = 0;
for (const [path, ok, required, what] of PROBES) {
  let status = 0;
  let body = null;
  let note = "";
  try {
    const r = await fetch(base + path, { headers: { "user-agent": "furlpay-smoke/1.0" }, signal: AbortSignal.timeout(20_000), redirect: "manual" });
    status = r.status;
    const text = await r.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    note = body ? JSON.stringify(body).slice(0, 110) : "";
  } catch (e) {
    note = String(e?.message ?? e).slice(0, 110);
  }
  const pass = ok(status, body);
  if (!pass && required) failed++;
  console.log(`${pass ? "PASS" : required ? "FAIL" : "WARN"}  ${String(status).padEnd(3)}  ${path.padEnd(40)} ${what}${pass ? "" : `  ${note}`}`);
}
console.log(failed ? `\n${failed} required check(s) failed against ${base}` : `\nall required checks passed against ${base}`);
process.exit(failed ? 1 : 0);
