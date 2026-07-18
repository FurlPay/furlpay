#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Backfill trade_lots from the legacy `holdings` aggregate.
//
// THE MISSING STEP between "migration 0006 applied" and "portfolios project
// from the ledger". 0006 creates EMPTY tables, so every pre-existing position
// has no lot. Without this, projectHoldings() sees an empty ledger for every
// user and the portfolio route stays on `legacy_aggregate` forever — and any
// alert on that fallback fires for 100% of users, permanently.
//
// One lot per holding, quantity and cost basis taken from the aggregate.
//
// ACCURACY LIMIT — read before running:
//   The original purchase dates were never recorded, so `acquired_at` is an
//   ESTIMATE. That is not cosmetic: acquisition date decides short- vs
//   long-term capital gains treatment. These rows are marked with a
//   `lot_backfill_` id prefix precisely so they can be identified later and
//   never mistaken for observed fills. Do not present their dates or tax
//   character to users as fact.
//
//   Aggregate basis also cannot be decomposed into the real per-purchase lots.
//   A user who bought three times gets ONE synthetic lot at the blended price.
//   Real fills after this point write their own accurate lots.
//
//   node apps/web/scripts/backfill-lots.mjs --dry     # report, write nothing
//   node apps/web/scripts/backfill-lots.mjs           # write
//   node apps/web/scripts/backfill-lots.mjs --user=<uuid>
//
// Rows are written with provenance='backfill' so downstream systems can tell a
// reconstructed lot from a real fill:
//   select count(*) from trade_lots where provenance <> 'execution';
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { bootstrapEnv } from "./lib/env-guard.mjs";

// Guard FIRST — this writes synthetic lots for EVERY user in the target
// project. Wrong target means fabricated tax lots in production.
console.log("Backfill trade_lots from holdings");
await bootstrapEnv("scripts/backfill-lots.mjs", { destructive: true });

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry");
const ONLY_USER = (process.argv.find((a) => a.startsWith("--user=")) || "").split("=")[1];

if (!SB_URL || !SB_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}

/**
 * Deterministic lot id from (user, symbol).
 *
 * Makes the backfill IDEMPOTENT: re-running upserts the same row instead of
 * minting a duplicate lot, which would silently double every position.
 */
function lotId(userId, symbol) {
  const h = createHash("sha1").update(`${userId}:${symbol}`).digest("hex").slice(0, 12);
  return `lot_backfill_${h}`;
}

console.log(`Backfill trade_lots from holdings${DRY ? "  [DRY RUN]" : ""}`);

// Preflight: 0006 must be applied, or every insert fails one at a time.
try {
  await sb("trade_lots?select=id&limit=1");
} catch (e) {
  console.error(`\ntrade_lots is not reachable — apply migration 0006 first.\n  ${e.message}\n`);
  process.exit(1);
}

const filter = ONLY_USER ? `&user_id=eq.${encodeURIComponent(ONLY_USER)}` : "";
const holdings = await sb(`holdings?select=user_id,symbol,shares,cost_basis${filter}`);
console.log(`  holdings rows: ${holdings.length}`);

// A zero-share holding has nothing to represent, and an open lot with zero
// quantity violates the open_lot_has_shares CHECK constraint.
const eligible = holdings.filter((h) => Number(h.shares) > 0);
const skipped = holdings.length - eligible.length;
if (skipped) console.log(`  skipped (zero shares): ${skipped}`);

const existing = await sb(`trade_lots?select=id${filter}`);
const known = new Set(existing.map((l) => l.id));
console.log(`  existing lots: ${existing.length}`);

// Estimated acquisition — see the accuracy limit at the top of this file.
const acquiredAt = new Date(Date.now() - 365 * 86_400_000).toISOString();

const rows = eligible.map((h) => ({
  id: lotId(h.user_id, h.symbol),
  user_id: h.user_id,
  symbol: h.symbol,
  quantity: Number(h.shares),
  cost_basis: Number(h.cost_basis ?? 0),
  acquired_at: acquiredAt,
  status: "open",
  // First-class provenance. The id prefix stays for readability, but THIS is
  // the queryable field: "which portfolios still rest on estimated lots?"
  provenance: "backfill",
  source_lot_id: null,
  corporate_action_id: null,
  order_id: null,
}));

const fresh = rows.filter((r) => !known.has(r.id));
console.log(`  to write: ${rows.length} (${fresh.length} new, ${rows.length - fresh.length} already backfilled)`);

if (DRY) {
  for (const r of rows.slice(0, 10)) {
    console.log(`    ${r.symbol.padEnd(6)} ${String(r.quantity).padStart(10)} sh  basis $${r.cost_basis}`);
  }
  if (rows.length > 10) console.log(`    … and ${rows.length - 10} more`);
  console.log("\n--dry: nothing written.");
  process.exit(0);
}

if (!rows.length) {
  console.log("\nNothing to backfill.");
  process.exit(0);
}

// Chunked upsert. Idempotent via the deterministic id, so a partial failure is
// safe to re-run — no duplicate positions.
const CHUNK = 500;
let written = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  await sb("trade_lots", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(batch),
  });
  written += batch.length;
  console.log(`  wrote ${written}/${rows.length}`);
}

// Verify the ledger now agrees with the aggregate it was derived from.
const after = await sb(`trade_lots?select=user_id,symbol,quantity,cost_basis&status=eq.open${filter}`);
const bySymbol = new Map();
for (const l of after) bySymbol.set(`${l.user_id}:${l.symbol}`, Number(l.quantity));

let mismatches = 0;
for (const h of eligible) {
  const got = bySymbol.get(`${h.user_id}:${h.symbol}`) ?? 0;
  if (Math.abs(got - Number(h.shares)) > 1e-6) {
    mismatches++;
    console.error(`  MISMATCH ${h.symbol}: holdings=${h.shares} lots=${got}`);
  }
}

console.log(`\nBackfilled ${written} lots. Mismatches: ${mismatches}`);
if (mismatches) {
  console.error("Ledger does not reconcile with holdings — investigate before serving projections.");
  process.exit(1);
}
console.log("Ledger reconciles with the holdings aggregate.");
