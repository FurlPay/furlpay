#!/usr/bin/env node
// Import a tokenized-assets CSV export into rwa_asset_snapshots (migration 0033).
//
//   node scripts/data/import-rwa-snapshot.mjs <file.csv> --as-of YYYY-MM-DD [--source "<label>"] [--apply]
//
// Expected header (Allium tokenized-assets export):
//   product_name,token_symbol,chain,issuer_name,asset_class,asset_type,market_cap_usd
//
// DRY RUN BY DEFAULT: parses and validates every row, prints the summary, and
// writes nothing. --apply writes, using DATABASE_URL (a Postgres connection
// string — for Supabase use the session pooler, port 5432). Upsert on
// (snapshot_date, chain, product_name, token_symbol): re-running the same file
// is a no-op; a different --as-of creates a new snapshot.
//
// Validation is strict; ANY invalid row aborts before writing (no partial
// imports). The market cap is kept as the exported decimal string.
// The connection string is never printed.

import { readFileSync, statSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
if (!file) {
  console.error("usage: import-rwa-snapshot.mjs <file.csv> --as-of YYYY-MM-DD [--source label] [--apply]");
  process.exit(2);
}
const asOf = flag("as-of");
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
  const mtime = statSync(file).mtime.toISOString().slice(0, 10);
  console.error(`--as-of YYYY-MM-DD is required (the export has no date column; the file was last modified ${mtime} UTC).`);
  process.exit(2);
}
const source = (flag("source") ?? "allium_tokenized_assets_export").slice(0, 120);

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const HEADER = ["product_name", "token_symbol", "chain", "issuer_name", "asset_class", "asset_type", "market_cap_usd"];
const DEC = /^\d{1,22}(\.\d{1,30})?$/;

const rows = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const head = rows.shift() ?? [];
if (head.join(",") !== HEADER.join(",")) {
  console.error(`unexpected header: ${head.join(",")}\nexpected:          ${HEADER.join(",")}`);
  process.exit(1);
}

const errors = [];
const keys = new Set();
const out = [];
rows.forEach((r, i) => {
  const line = i + 2;
  if (r.length !== HEADER.length) return errors.push(`line ${line}: ${r.length} columns`);
  const [product_name, token_symbol, chain, issuer_name, asset_class, asset_type, mcap] = r.map((v) => v.trim());
  if (!product_name || product_name.length > 200) errors.push(`line ${line}: product_name`);
  if (token_symbol.length > 64) errors.push(`line ${line}: token_symbol too long`);
  if (!/^[a-z0-9_-]{2,32}$/.test(chain)) errors.push(`line ${line}: chain "${chain}"`);
  if (!issuer_name || issuer_name.length > 200) errors.push(`line ${line}: issuer_name`);
  if (!/^[a-z_]{2,40}$/.test(asset_class)) errors.push(`line ${line}: asset_class "${asset_class}"`);
  if (!/^[a-z0-9_]{2,60}$/.test(asset_type)) errors.push(`line ${line}: asset_type "${asset_type}"`);
  // Exponent notation (1e-7) is normalized to a plain decimal; anything else must be a plain decimal already.
  let mc = mcap;
  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(mc)) mc = Number(mc).toFixed(8);
  if (!DEC.test(mc)) errors.push(`line ${line}: market_cap_usd "${mcap}"`);
  const k = `${chain}|${product_name}|${token_symbol}`;
  if (keys.has(k)) errors.push(`line ${line}: duplicate (chain, product, symbol)`);
  keys.add(k);
  out.push({ snapshot_date: asOf, chain, product_name, token_symbol, issuer_name, asset_class, asset_type, market_cap_usd: mc, source });
});

const total = out.reduce((a, r) => a + Number(r.market_cap_usd), 0);
const by = (k) => Object.entries(out.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
console.log(`file:        ${file}`);
console.log(`snapshot:    ${asOf}  source: ${source}`);
console.log(`rows:        ${out.length}  (zero market cap: ${out.filter((r) => Number(r.market_cap_usd) === 0).length}, empty symbol: ${out.filter((r) => !r.token_symbol).length})`);
console.log(`total mcap:  $${(total / 1e9).toFixed(2)}B`);
console.log(`chains:      ${by("chain").length}   issuers: ${by("issuer_name").length}   products: ${new Set(out.map((r) => r.product_name)).size}`);
console.log(`classes:     ${by("asset_class").map(([k, v]) => `${k}:${v}`).join(" ")}`);
if (errors.length) {
  console.error(`\n${errors.length} invalid row(s); nothing written:\n  ${errors.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
if (!apply) {
  console.log("\nDRY RUN — valid. Re-run with --apply and DATABASE_URL to write.");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 2, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
let written = 0;
try {
  await client.query("begin");
  for (let i = 0; i < out.length; i += 1000) {
    const chunk = out.slice(i, i + 1000);
    const r = await client.query(
      `insert into rwa_asset_snapshots (snapshot_date, chain, product_name, token_symbol, issuer_name, asset_class, asset_type, market_cap_usd, source)
       select x.snapshot_date::date, x.chain, x.product_name, x.token_symbol, x.issuer_name, x.asset_class, x.asset_type, x.market_cap_usd::numeric, x.source
         from jsonb_to_recordset($1::jsonb) as x(snapshot_date text, chain text, product_name text, token_symbol text, issuer_name text, asset_class text, asset_type text, market_cap_usd text, source text)
       on conflict (snapshot_date, chain, product_name, token_symbol) do update set
         issuer_name = excluded.issuer_name, asset_class = excluded.asset_class, asset_type = excluded.asset_type,
         market_cap_usd = excluded.market_cap_usd, source = excluded.source, imported_at = now()
       where (rwa_asset_snapshots.issuer_name, rwa_asset_snapshots.asset_class, rwa_asset_snapshots.asset_type, rwa_asset_snapshots.market_cap_usd)
             is distinct from (excluded.issuer_name, excluded.asset_class, excluded.asset_type, excluded.market_cap_usd)`,
      [JSON.stringify(chunk)]
    );
    written += r.rowCount ?? 0;
  }
  // The whole file or nothing.
  const check = await client.query("select count(*)::int n, coalesce(sum(market_cap_usd),0)::text v from rwa_asset_snapshots where snapshot_date = $1", [asOf]);
  if (check.rows[0].n !== out.length) throw new Error(`row count after import ${check.rows[0].n} != file ${out.length}`);
  await client.query("commit");
  console.log(`\nAPPLIED: ${written} row(s) inserted/changed; snapshot ${asOf} now holds ${check.rows[0].n} rows, $${(Number(check.rows[0].v) / 1e9).toFixed(2)}B.`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(`\nFAILED, rolled back: ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
