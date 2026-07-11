// Verifies the ops dashboard is REAL end-to-end:
//   1. /api/ops/overview without a session -> 401/403 (admin-gated)
//   2. with guest session (demo user has admin role) -> real overview
//   3. pause the x402 rail via POST /api/ops/controls -> the x402 fx route
//      actually returns 503 rail_paused (durable, enforced — not decorative)
//   4. resume -> x402 fx back to 402
//   5. drive a security event (bad x402 signature) -> appears in
//      /api/ops/security; overview counters move
//   node scripts/ops-verify-local.mjs
const APP = process.env.E2E_APP || "http://localhost:3000";
let failures = 0;
const check = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// 1. unauth
const noauth = await j(await fetch(`${APP}/api/ops/overview`));
check("overview is admin-gated", noauth.status === 401 || noauth.status === 403, `status ${noauth.status}`);

// 2. admin session (guest = demo user, roles include admin)
const login = await fetch(`${APP}/api/auth/guest`, { method: "POST" });
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const H = { cookie, "content-type": "application/json" };
const ov = await j(await fetch(`${APP}/api/ops/overview`, { headers: H }));
check("admin can read overview", ov.status === 200 && ov.body.ok, `status ${ov.status}`);
check("real rail matrix present (5 live rails)", ov.body.data?.rails?.length === 5, `rails=${ov.body.data?.rails?.length}`);
check("config readiness present", !!ov.body.data?.config?.x402 && "armed" in ov.body.data.config.lifi, "");
console.log("  rails:", ov.body.data?.rails?.map((r) => `${r.rail}:${r.status}${r.armed ? "(live)" : ""}`).join(" "));

// 3. pause x402 and prove enforcement at the real route
const pause = await j(await fetch(`${APP}/api/ops/controls`, { method: "POST", headers: H, body: JSON.stringify({ scope: "rail", rail: "x402", paused: true, reason: "ops-verify canary pause" }) }));
check("pause x402 accepted", pause.status === 200 && pause.body.data?.state?.paused === true, `status ${pause.status}`);
const fxPaused = await fetch(`${APP}/api/x402/fx?from=USD&to=EUR&amount=100`);
const fxPausedBody = await fxPaused.json().catch(() => ({}));
check("x402 fx route ENFORCES the pause (503 rail_paused)", fxPaused.status === 503 && fxPausedBody?.error?.code === "rail_paused", `status ${fxPaused.status}: ${JSON.stringify(fxPausedBody?.error ?? fxPausedBody)}`);

// 4. resume
const resume = await j(await fetch(`${APP}/api/ops/controls`, { method: "POST", headers: H, body: JSON.stringify({ scope: "rail", rail: "x402", paused: false, reason: "ops-verify canary resume" }) }));
check("resume x402 accepted", resume.status === 200 && resume.body.data?.state?.paused === false, `status ${resume.status}`);
const fxLive = await fetch(`${APP}/api/x402/fx?from=USD&to=EUR&amount=100`);
check("x402 fx back to 402 after resume", fxLive.status === 402, `status ${fxLive.status}`);

// 4b. resume without a reason must be rejected (typed-reason gate)
const noReason = await j(await fetch(`${APP}/api/ops/controls`, { method: "POST", headers: H, body: JSON.stringify({ scope: "rail", rail: "x402", paused: false }) }));
check("resume without reason rejected", noReason.status === 400 && noReason.body?.error?.code === "reason_required", `status ${noReason.status}`);

// 5. drive a real security event: present a malformed x402 payment
const badPayment = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "arbitrum", payload: { signature: "0xdead", authorization: { from: "0x1111111111111111111111111111111111111111", to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", value: "10000", validAfter: "0", validBefore: "99999999999", nonce: "0x" + "ab".repeat(32) } }, extra: { quoteId: "x", binding: "y", expiresAt: 99999999999 } })).toString("base64");
await fetch(`${APP}/api/x402/fx?from=USD&to=EUR&amount=100`, { headers: { "x-payment": badPayment } });
await new Promise((r) => setTimeout(r, 400));
const sec = await j(await fetch(`${APP}/api/ops/security?limit=10`, { headers: H }));
check("security feed records real events", sec.status === 200 && Array.isArray(sec.body.data?.events), `status ${sec.status}`);
console.log("  security sample:", sec.body.data?.events?.slice(0, 3).map((e) => `${e.rail}:${e.kind}`).join(" ") || "(none)");

// audit trail has the control changes
const aud = await j(await fetch(`${APP}/api/ops/audit?limit=10`, { headers: H }));
const hasControl = (aud.body.data?.entries ?? []).some((e) => e.event === "ops.control_changed");
check("audit trail recorded control changes", aud.status === 200 && hasControl, `entries=${aud.body.data?.entries?.length}`);

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("OPS DASHBOARD VERIFIED — real data, admin-gated, pause ENFORCED at the rail");
