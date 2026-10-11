#!/usr/bin/env node
// Post-deploy smoke test: requests against production (or SMOKE_BASE_URL).
// Exits non-zero when anything a user depends on is down, or when a security
// boundary is open. Sends no credentials and triggers no side effects (no
// OTP, no email, no payment, no stored row): every probe is a read, except the
// one partnership POST with an empty body, which validation refuses before
// anything is stored (it does count against that endpoint's rate limit).
//
//   npm run smoke:prod            # https://furlpay.com
//   SMOKE_BASE_URL=https://web-xyz.vercel.app npm run smoke:prod
//
// Vercel previews sit behind Deployment Protection; probe one with
//   SMOKE_BYPASS=<automation bypass secret> SMOKE_BASE_URL=... npm run smoke:prod
// (the secret is sent as x-vercel-protection-bypass and never printed).

const base = (process.env.SMOKE_BASE_URL ?? "https://furlpay.com").replace(/\/+$/, "");
const bypass = process.env.SMOKE_BYPASS ?? "";

const to = (path) => (s, _b, loc) => s >= 300 && s < 400 && !!loc && new URL(loc, base).pathname === path;
const page = (s) => s === 200;

/** [path, what must hold, required?, label, init?] — "required" failures fail the run. */
const PROBES = [
  ["/api/health", (s) => s === 200, true, "liveness"],
  ["/api/health/ready", (s) => s === 200, true, "readiness: KV write + database"],
  ["/api/auth/passkey/authenticate", (s) => s === 200, true, "sign-in can start (passkey challenge)"],
  ["/api/rails", (s) => s === 200, true, "rail operational controls readable"],
  ["/api/x402/fx", (s) => s === 200, false, "x402 FX quote"],
  ["/onchain", page, true, "dashboard page"],
  ["/api/onchain/token/usdc/metrics", (s, b) => s === 200 && b?.data?.available === true, false, "USDC index read model (needs migration 0036)"],
  ["/api/onchain/cctp", (s, b) => s === 200 && b?.data?.available === true, false, "CCTP index (needs 0034/0035)"],

  // Public pages: must render for an anonymous visitor, never bounce to /login.
  ["/", page, true, "homepage"],
  ["/partnerships", page, true, "partnership page (public)"],
  ["/partners", to("/partnerships"), true, "old partners URL redirects to /partnerships"],
  ["/dashboard/partnerships", to("/partnerships"), true, "old staff URL redirects to the public page"],
  ["/travel", page, true, "travel home"],
  ["/travel/stays?city=Lisbon", page, true, "stays results"],
  ["/travel/flights", page, true, "flights"],
  ["/travel/car-rentals", page, true, "car rentals"],
  ["/travel/activities", page, true, "activities"],
  ["/travel/deals", page, true, "deals"],
  ["/travel/visa", page, true, "entry requirements"],

  // Security boundaries: these must stay closed to an anonymous request.
  ["/api/admin/partnerships", (s) => s === 401 || s === 403, true, "partnership inquiries are admin-only"],

  // Partnership form endpoint: an empty body must be refused (400). A 503 means
  // the fail-closed rate-limit store is down, so no visitor can submit.
  ["/api/partnerships/inquiries", (s) => s === 400, false, "inquiry endpoint validates (503 = rate-limit store down)",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
];

let failed = 0;
for (const [path, ok, required, what, init] of PROBES) {
  let status = 0;
  let body = null;
  let location = null;
  let note = "";
  try {
    const headers = { "user-agent": "furlpay-smoke/1.0", ...(init?.headers ?? {}) };
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;
    const r = await fetch(base + path, { ...init, headers, signal: AbortSignal.timeout(20_000), redirect: "manual" });
    status = r.status;
    location = r.headers.get("location");
    const text = await r.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    note = body ? JSON.stringify(body).slice(0, 110) : location ? `→ ${location}` : "";
  } catch (e) {
    note = String(e?.message ?? e).slice(0, 110);
  }
  const pass = ok(status, body, location);
  if (!pass && required) failed++;
  console.log(`${pass ? "PASS" : required ? "FAIL" : "WARN"}  ${String(status).padEnd(3)}  ${path.padEnd(40)} ${what}${pass ? "" : `  ${note}`}`);
}
console.log(failed ? `\n${failed} required check(s) failed against ${base}` : `\nall required checks passed against ${base}`);
process.exit(failed ? 1 : 0);
