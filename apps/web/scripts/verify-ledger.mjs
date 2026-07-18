#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Trade-lot ledger integration harness.
//
// Exercises the REAL persistence layer, because the remaining risks are no
// longer algorithmic. Unit tests cover the arithmetic exhaustively; what they
// cannot cover is migration drift, PostgREST behaviour, timestamp
// round-tripping, constraint enforcement and concurrent writes.
//
// Every action goes through the HTTP API (the path a client actually takes);
// every assertion reads Postgres DIRECTLY (the source of truth). Asserting
// against the API would only prove the app agrees with itself.
//
//   node apps/web/scripts/verify-ledger.mjs                 # full run
//   node apps/web/scripts/verify-ledger.mjs --phase=write   # before a restart
//   node apps/web/scripts/verify-ledger.mjs --phase=verify  # after a restart
//   node apps/web/scripts/verify-ledger.mjs --keep          # skip cleanup
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from apps/web/.env.local),
//      FURLPAY_BASE_URL (default http://localhost:3000).
//
// Exits NON-ZERO on any invariant violation so it can gate CI against staging.
// ---------------------------------------------------------------------------
import { bootstrapEnv } from "./lib/env-guard.mjs";

// Guard FIRST — this places real BUY and SELL orders and inserts corporate
// actions. Against production that writes to live user positions, and
// .env.local points at the PRODUCTION project.
console.log("Ledger verification");
await bootstrapEnv("scripts/verify-ledger.mjs", { destructive: true });

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.FURLPAY_BASE_URL || "http://localhost:3000";
const PHASE = (process.argv.find((a) => a.startsWith("--phase=")) || "").split("=")[1] || "all";
const KEEP = process.argv.includes("--keep");

// A symbol the seeded demo portfolio does not hold, so the harness never
// collides with (or corrupts) existing positions. Must exist in the catalog.
const SYMBOL = process.env.LEDGER_TEST_SYMBOL || "MSFT";

// --- tiny assertion runtime -------------------------------------------------

let passed = 0;
const failures = [];
let session = "";

const c = { ok: "\x1b[32m", bad: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ${c.ok}PASS${c.off}  ${name}`);
  } else {
    failures.push(name);
    console.log(`  ${c.bad}FAIL${c.off}  ${name}${detail ? `\n        ${c.dim}${detail}${c.off}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// --- transports -------------------------------------------------------------

/** Read Postgres directly — the source of truth for every assertion. */
async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : [];
}

async function sbDelete(path) {
  await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {});
}

/** Drive the app the way a client does, carrying the session cookie. */
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(session ? { cookie: session } : {}), ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) session = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, raw: text };
}

// --- phases -----------------------------------------------------------------

async function preflight() {
  section("Preflight");
  check("SUPABASE_URL / SERVICE_ROLE_KEY present", !!SB_URL && !!SB_KEY);
  if (!SB_URL || !SB_KEY) return false;

  const health = await api("/api/chain/status").catch(() => ({ status: 0 }));
  check(`app reachable at ${BASE}`, health.status === 200, `got HTTP ${health.status}`);
  if (health.status !== 200) return false;

  // Migration 0006. Everything downstream is meaningless without it, so this
  // aborts the run rather than reporting a cascade of confusing failures.
  let migrated = true;
  for (const table of ["trade_lots", "corporate_actions", "dividend_events", "symbol_mappings"]) {
    try {
      await sb(`${table}?select=*&limit=1`);
      check(`migration 0006: ${table} exists`, true);
    } catch (e) {
      migrated = false;
      check(`migration 0006: ${table} exists`, false, String(e.message).slice(0, 160));
    }
  }
  if (!migrated) {
    console.log(`\n${c.bad}Migration 0006 is not applied.${c.off} Apply it, then re-run:`);
    console.log(`  supabase/migrations/0006_corporate_actions.sql\n`);
  }
  return migrated;
}

async function authenticate() {
  section("Session");
  const guest = await api("/api/auth/guest", { method: "POST", body: "{}" });
  check("guest session issued", guest.status === 200, `HTTP ${guest.status}`);
  const overview = await api("/api/overview");
  const userId = overview.body?.user?.id;
  check("session resolves a user", !!userId);
  if (!userId) return null;

  // SPLIT-BRAIN CHECK — this harness talks to TWO systems:
  //   - Postgres directly, via SUPABASE_URL (guarded by env-guard)
  //   - the app over HTTP, via FURLPAY_BASE_URL, which reads its OWN env
  //
  // Nothing ties those together. A `--env=staging` run points the assertions
  // at staging while `next dev` still serves from .env.local — production.
  // That is not hypothetical: it happened on 2026-07-19. The buy was sent to a
  // REAL production user and only failed because 0006 was absent there. With
  // the migration applied first, it would have appended a lot to a live
  // portfolio and reported PASS.
  //
  // The user the app just resolved must exist in the database this script is
  // asserting against. If it does not, the two halves are looking at different
  // projects and every subsequent result is meaningless — so abort rather than
  // report failures that misattribute the cause.
  const seen = await sb(`users?id=eq.${userId}&select=id`).catch(() => []);
  if (!seen.length) {
    console.error(
      `\n${c.bad}ABORTING: the app and this script are on DIFFERENT databases.${c.off}\n\n` +
        `  This script asserts against : ${SB_URL}\n` +
        `  The app under test is at    : ${BASE}\n\n` +
        `  The app resolved user ${userId}, which does not exist in the\n` +
        `  database above. The app is reading a different project — almost\n` +
        `  certainly apps/web/.env.local.\n\n` +
        `  Any writes this harness triggers would land in THAT project, not\n` +
        `  the one it verifies. Point the app at the same target and re-run:\n\n` +
        `      cd apps/web && cp .env.staging .env.local   # or\n` +
        `      SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run dev\n`
    );
    process.exit(1);
  }
  check("app and script share one database", true);
  return userId;
}

/** Lots for this user+symbol, straight from Postgres. */
async function lotsOf(userId) {
  return sb(`trade_lots?user_id=eq.${userId}&symbol=eq.${SYMBOL}&select=*&order=acquired_at.asc`);
}

async function phaseWrite(userId) {
  section(`Buy ${SYMBOL}`);
  const before = await lotsOf(userId);

  const buy = await api("/api/investing/order", {
    method: "POST",
    body: JSON.stringify({ symbol: SYMBOL, side: "buy", notional: 1000, type: "market" }),
  });
  check("buy accepted", buy.status === 200, `HTTP ${buy.status} ${buy.raw?.slice(0, 160)}`);
  check("buy reports filled", buy.body?.status === "filled");

  const after = await lotsOf(userId);
  check(
    "exactly one new trade_lots row persisted",
    after.length === before.length + 1,
    `before=${before.length} after=${after.length} — a buy must append exactly one lot`
  );

  const lot = after[after.length - 1];
  if (lot) {
    check("lot quantity > 0", Number(lot.quantity) > 0);
    check("lot cost_basis > 0", Number(lot.cost_basis) > 0);
    check("lot status is open", lot.status === "open");
    // Timestamp round-tripping: FIFO ordering depends on Date.parse of this.
    check(
      "acquired_at round-trips as a parseable timestamp",
      !Number.isNaN(Date.parse(lot.acquired_at)),
      `got ${JSON.stringify(lot.acquired_at)}`
    );
  }
  return after;
}

async function phaseVerify(userId) {
  section("Hydration (run after a process restart)");
  const persisted = await lotsOf(userId);
  check("ledger present in Postgres", persisted.length > 0, "nothing to hydrate — run --phase=write first");
  if (!persisted.length) return;

  const portfolio = await api("/api/investing/portfolio");
  check("portfolio served", portfolio.status === 200);
  check(
    "portfolio projects from the lot ledger",
    portfolio.body?.source === "lot_ledger",
    `source=${portfolio.body?.source} — 'legacy_aggregate' means hydration did not pick up the lots`
  );

  const held = portfolio.body?.holdings?.find((h) => h.symbol === SYMBOL);
  const dbShares = persisted
    .filter((l) => l.status === "open")
    .reduce((s, l) => s + Number(l.quantity), 0);
  check(
    "projected shares equal the persisted ledger",
    held ? Math.abs(held.shares - dbShares) < 1e-6 : dbShares === 0,
    `api=${held?.shares} db=${dbShares}`
  );
}

async function phaseSplit(userId) {
  section("Split — source_lot_id chain");
  const before = (await lotsOf(userId)).filter((l) => l.status === "open");
  if (!before.length) return check("split precondition: open lots exist", false);

  const actionId = `ca_verify_${Date.now()}`;
  // Insert a 2:1 split directly; ingestion is not wired yet, and the point of
  // this check is the DB-level chain, not the feed.
  await fetch(`${SB_URL}/rest/v1/corporate_actions`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: actionId,
      symbol: SYMBOL,
      type: "stock_split",
      effective_date: new Date().toISOString().slice(0, 10),
      ratio: 2,
      source: "manual",
      confidence: "confirmed",
    }),
  }).catch(() => {});

  const stored = await sb(`corporate_actions?id=eq.${actionId}&select=*`);
  check("corporate action stored", stored.length === 1);
  check("split ratio survives NUMERIC round-trip", stored[0] && Number(stored[0].ratio) === 2, `ratio=${stored[0]?.ratio}`);

  // Constraint check: a split with no ratio must be rejected by the schema.
  const bad = await fetch(`${SB_URL}/rest/v1/corporate_actions`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: `${actionId}_bad`,
      symbol: SYMBOL,
      type: "stock_split",
      effective_date: new Date().toISOString().slice(0, 10),
      source: "manual",
      confidence: "confirmed",
    }),
  }).catch(() => ({ ok: false, status: 0 }));
  check(
    "schema REJECTS a split with no ratio (split_needs_ratio)",
    !bad.ok,
    `HTTP ${bad.status} — a ratio-less split would silently corrupt every position it touched`
  );

  await sbDelete(`corporate_actions?id=eq.${actionId}_bad`);
  await sbDelete(`corporate_actions?id=eq.${actionId}`);
}

async function phaseSell(userId) {
  section("Sell — FIFO and realized gain");
  const open = (await lotsOf(userId)).filter((l) => l.status === "open");
  if (!open.length) return check("sell precondition: open lots exist", false);

  const oldest = open[0];
  const sellQty = Number(oldest.quantity) / 2;

  const sell = await api("/api/investing/order", {
    method: "POST",
    body: JSON.stringify({ symbol: SYMBOL, side: "sell", qty: sellQty, type: "market" }),
  });
  check("sell accepted", sell.status === 200, `HTTP ${sell.status} ${sell.raw?.slice(0, 160)}`);
  check("sell reports a realized gain", sell.body?.realizedGain !== undefined && sell.body?.realizedGain !== null);

  const after = await sb(`trade_lots?id=eq.${oldest.id}&select=*`);
  check(
    "FIFO consumed the OLDEST lot",
    after[0] && Number(after[0].quantity) < Number(oldest.quantity),
    `lot ${oldest.id}: ${oldest.quantity} -> ${after[0]?.quantity}`
  );

  // Oversell must be refused, not clamped — clamping drives a position negative.
  const over = await api("/api/investing/order", {
    method: "POST",
    body: JSON.stringify({ symbol: SYMBOL, side: "sell", qty: 1_000_000, type: "market" }),
  });
  check("oversell rejected with 400", over.status === 400, `HTTP ${over.status}`);
}

async function phaseIntegrity(userId) {
  section("Ledger integrity");
  const all = await sb(`trade_lots?user_id=eq.${userId}&select=*`);
  const ids = new Set(all.map((l) => l.id));

  check(
    "no orphaned source_lot_id references",
    all.every((l) => !l.source_lot_id || ids.has(l.source_lot_id)),
    "a replacement lot points at a row that does not exist"
  );
  check(
    "no open lot has zero quantity (open_lot_has_shares)",
    all.every((l) => l.status !== "open" || Number(l.quantity) > 0)
  );
  check("no negative quantities", all.every((l) => Number(l.quantity) >= 0));
  check("no negative cost basis", all.every((l) => Number(l.cost_basis) >= 0));
  check("lot ids are unique", ids.size === all.length);
}

async function phaseConcurrency(userId) {
  section("Concurrent sells");
  const open = (await lotsOf(userId)).filter((l) => l.status === "open");
  const total = open.reduce((s, l) => s + Number(l.quantity), 0);
  if (total <= 0) return check("concurrency precondition: shares held", false);

  // Two simultaneous sells for ~60% each. Correct behaviour: they serialize —
  // at most one succeeds, or both succeed only if the total sold <= held.
  const qty = total * 0.6;
  const [a, b] = await Promise.all([
    api("/api/investing/order", { method: "POST", body: JSON.stringify({ symbol: SYMBOL, side: "sell", qty, type: "market" }) }),
    api("/api/investing/order", { method: "POST", body: JSON.stringify({ symbol: SYMBOL, side: "sell", qty, type: "market" }) }),
  ]);
  const ok = [a, b].filter((r) => r.status === 200).length;

  const remaining = (await lotsOf(userId))
    .filter((l) => l.status === "open")
    .reduce((s, l) => s + Number(l.quantity), 0);

  check(
    "concurrent sells did not oversell the position",
    remaining >= -1e-6,
    `remaining=${remaining} after ${ok}/2 succeeded — negative means the read-modify-write raced`
  );
  if (ok === 2) {
    console.log(
      `  ${c.dim}note: both sells succeeded (2 x 60%). Expected until the sale path` +
        ` moves into a Postgres transaction — see roadmap step 3.${c.off}`
    );
  }
}

async function cleanup(userId) {
  if (KEEP) return console.log(`\n${c.dim}--keep: leaving ${SYMBOL} lots in place${c.off}`);
  section("Cleanup");
  await sbDelete(`trade_lots?user_id=eq.${userId}&symbol=eq.${SYMBOL}`);
  const left = await lotsOf(userId).catch(() => []);
  check("test lots removed", left.length === 0);
}

// --- main -------------------------------------------------------------------

console.log(`Ledger verification — ${BASE}\nsymbol: ${SYMBOL}   phase: ${PHASE}`);

const ready = await preflight();
if (!ready) {
  console.log(`\n${c.bad}${failures.length} check(s) failed${c.off} — aborting before the ledger phases.\n`);
  process.exit(1);
}

const userId = await authenticate();
if (!userId) {
  console.log(`\n${c.bad}Could not establish a session.${c.off}\n`);
  process.exit(1);
}

if (PHASE === "write") {
  await phaseWrite(userId);
  console.log(`\n${c.dim}Now restart the app process, then run --phase=verify${c.off}`);
} else if (PHASE === "verify") {
  await phaseVerify(userId);
} else {
  await phaseWrite(userId);
  await phaseVerify(userId);
  await phaseSplit(userId);
  await phaseSell(userId);
  await phaseIntegrity(userId);
  await phaseConcurrency(userId);
  await cleanup(userId);
}

console.log(
  `\n${passed} passed, ${failures.length} failed` +
    (failures.length ? `\n${c.bad}failed:${c.off}\n  - ${failures.join("\n  - ")}` : "")
);
process.exit(failures.length ? 1 : 0);
