#!/usr/bin/env node
// Drives the Ethereum USDC index (migration 0036) from OUTSIDE the web
// deployment (Vercel Cron fires at most daily on this plan).
//
//   FURLPAY_BASE_URL=https://furlpay.com FURLPAY_CRON_SECRET=… node scripts/onchain/usdc-index-worker.mjs
//
// Each call to GET /api/cron/usdc-index runs one pass (newly finalized ranges,
// then historical units, then the materialised windows). While the history is
// BACKFILLING the worker calls again immediately; once LIVE / CATCHING_UP it
// waits USDC_INDEX_INTERVAL_MS (default 60 s — Ethereum finalizes one epoch,
// 32 blocks, every ~6.4 min). Failures back off exponentially to 5 min.
//
// It holds no state: cursors and unit leases live in Postgres, so it can be
// restarted at any time and two copies cannot double-count. Logs are JSON
// lines; the cron secret is never logged.

const base = (process.env.FURLPAY_BASE_URL ?? "").replace(/\/+$/, "");
const secret = process.env.FURLPAY_CRON_SECRET ?? "";
const interval = Math.max(10_000, Number(process.env.USDC_INDEX_INTERVAL_MS ?? 60_000) || 60_000);
if (!/^https?:\/\//.test(base) || !secret) {
  console.error("FURLPAY_BASE_URL and FURLPAY_CRON_SECRET are required");
  process.exit(2);
}
const log = (event, f = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...f }));
let backoff = 0;
log("indexer_started", { base, intervalMs: interval });
for (;;) {
  const t0 = Date.now();
  let wait = interval;
  try {
    const r = await fetch(`${base}/api/cron/usdc-index`, { headers: { "x-furlpay-cron-key": secret }, signal: AbortSignal.timeout(90_000) });
    const b = await r.json().catch(() => ({}));
    const reps = (b.reports ?? []).map((x) => ({ mode: x.mode, status: x.status, commits: x.commits, events: x.events, to: x.to, errors: (x.errors ?? []).slice(0, 2) }));
    log(r.ok ? "pass" : "pass_failed", { http: r.status, state: b.status, reason: b.reason, reports: reps, ms: Date.now() - t0 });
    if (r.status === 503) wait = 5 * 60_000; // not migrated / not configured: check again later
    else if (!r.ok) {
      backoff = Math.min(300_000, backoff ? backoff * 2 : 5_000);
      wait = backoff;
    } else {
      if (backoff) log("indexer_recovered", {});
      backoff = 0;
      const backfilling = b.status === "BACKFILLING" && (b.reports ?? []).some((x) => x.mode === "backfill" && x.status !== "caught_up");
      wait = backfilling || b.status === "CATCHING_UP" ? 1_000 : interval;
    }
  } catch (e) {
    backoff = Math.min(300_000, backoff ? backoff * 2 : 5_000);
    wait = backoff;
    log("indexer_error", { error: String(e?.message ?? e).slice(0, 200) });
  }
  await new Promise((r) => setTimeout(r, wait));
}
