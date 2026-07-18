#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Asset universe sync — Alpaca /v2/assets -> src/lib/markets/universe.json
//
// WHY: the tradable universe was a hand-written list of 391 symbols, so an
// asset nobody had typed in simply did not exist — in the web app, the
// extension, the Android app and the watch at once, because all four read the
// same catalog. New listings never appeared, and "why is X missing" had no
// answer other than "someone has to edit a TypeScript file".
//
// This syncs the real universe from the broker instead. The curated catalog
// (catalog.ts) is NOT replaced: it stays the enrichment layer that supplies
// sector, industry, logos and CoinGecko ids, which Alpaca does not provide.
//
//   universe.json  = which assets EXIST and are tradable   (synced, ~11k)
//   catalog.ts     = what we KNOW about the notable ones   (curated, 391)
//
// Run:  node apps/web/scripts/sync-assets.mjs [--paper] [--dry]
// Needs ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY (reads apps/web/.env.local).
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..");
const OUT = join(WEB_ROOT, "src", "lib", "markets", "universe.json");

const DRY = process.argv.includes("--dry");
const PAPER = process.argv.includes("--paper") || true; // data-only; paper host is fine

/** Minimal .env.local reader — no dependency, and never logs values. */
function loadEnv() {
  const file = join(WEB_ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const KEY = process.env.ALPACA_API_KEY_ID;
const SECRET = process.env.ALPACA_API_SECRET_KEY;
if (!KEY || !SECRET) {
  console.error("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are required.");
  process.exit(1);
}

const HOST = PAPER ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";

/**
 * Exchanges we surface. OTC is deliberately excluded: it is the bulk of the
 * raw list (shells, expired warrants, delisted husks like "BAUDAX BIO INC"),
 * it has no reliable IEX quote, and putting it in a consumer investing app
 * would bury real companies under thousands of untradable tickers.
 */
const EXCHANGES = new Set(["NASDAQ", "NYSE", "ARCA", "AMEX", "BATS", "NYSEARCA"]);

async function fetchAssets() {
  const url = `${HOST}/v2/assets?status=active&asset_class=us_equity`;
  const res = await fetch(url, {
    headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET },
    signal: AbortSignal.timeout(120_000), // the full list is ~10MB
  });
  if (!res.ok) throw new Error(`alpaca /v2/assets ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

function normalize(raw) {
  return raw
    .filter((a) => a.tradable && a.status === "active" && EXCHANGES.has(a.exchange))
    .map((a) => ({
      symbol: a.symbol,
      name: (a.name || a.symbol).trim(),
      exchange: a.exchange,
      // Drives the $1-minimum investing flow — a non-fractionable asset must
      // not be offered as a fractional buy.
      fractionable: !!a.fractionable,
      shortable: !!a.shortable,
      marginable: !!a.marginable,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const started = Date.now();
console.log(`Fetching tradable US equities from ${HOST} …`);
const raw = await fetchAssets();
console.log(`  received ${raw.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const assets = normalize(raw);
const byExchange = assets.reduce((m, a) => ((m[a.exchange] = (m[a.exchange] || 0) + 1), m), {});

console.log(`  tradable on listed exchanges : ${assets.length}`);
console.log(`  fractionable                 : ${assets.filter((a) => a.fractionable).length}`);
console.log(`  by exchange                  : ${JSON.stringify(byExchange)}`);

if (DRY) {
  console.log("\n--dry: not writing. Sample:");
  for (const a of assets.slice(0, 5)) console.log("   ", a.symbol.padEnd(6), a.name);
  process.exit(0);
}

// Refuse to overwrite a healthy file with a suspiciously small result — a
// partial download or an upstream outage must not silently shrink the
// investable universe.
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    const prevCount = prev.assets?.length ?? 0;
    if (prevCount > 0 && assets.length < prevCount * 0.8) {
      console.error(
        `REFUSING to write: ${assets.length} assets is <80% of the previous ${prevCount}. ` +
          `Re-run when upstream is healthy, or delete ${OUT} to force.`
      );
      process.exit(1);
    }
  } catch {
    /* unreadable previous file — proceed */
  }
}

writeFileSync(
  OUT,
  JSON.stringify({ syncedAt: new Date().toISOString(), source: "alpaca:/v2/assets", assets }, null, 0) + "\n"
);
console.log(`\nWrote ${assets.length} assets -> ${OUT}`);
