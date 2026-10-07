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
// string — for Supabase use the session pooler, port 5432). One transaction;
// upsert on (snapshot_date, chain, product_name, token_symbol): re-running the
// same file is a no-op; a different --as-of adds a snapshot and never touches
// earlier ones. ANY invalid row aborts before writing. Money stays an exact
// decimal string end to end (rwa-csv.mjs). The source file is only read.
// The connection string is never printed.

import { readFileSync, statSync } from "node:fs";
import pg from "pg";
import { normalizeMoney, parseCsv, summarize, validateRows } from "./rwa-csv.mjs";

const args = process.argv.slice(2);
const VALUED = new Set(["--as-of", "--source"]);
const file = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
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
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) {
  const mtime = statSync(file).mtime.toISOString().slice(0, 10);
  console.error(`--as-of YYYY-MM-DD is required and must be a real date (the export has no date column; the file was last modified ${mtime} UTC).`);
  process.exit(2);
}
// A snapshot from the future would become "latest" and outrank every live
// refresh until that date arrives.
if (asOf > new Date().toISOString().slice(0, 10)) {
  console.error(`--as-of ${asOf} is in the future (UTC today is ${new Date().toISOString().slice(0, 10)}).`);
  process.exit(2);
}
const source = (flag("source") ?? "allium_tokenized_assets_export").slice(0, 120);

const { rows, errors } = validateRows(parseCsv(readFileSync(file, "utf8")), { asOf, source });
const s = summarize(rows);
const B = (v) => `$${(Number(v) / 1e9).toFixed(2)}B`;
console.log(`file:        ${file}`);
console.log(`snapshot:    ${asOf}  source: ${source}`);
console.log(`rows:        ${s.rows}  non-zero: ${s.nonzero}  zero: ${s.zero}  empty symbol: ${s.emptySymbol}`);
console.log(`total:       ${B(s.totalUsd)}  (exact ${s.totalUsd})`);
console.log(`products:    ${s.products}   issuers: ${s.issuers}   chains: ${s.chains}`);
if (errors.length) {
  console.error(`\n${errors.length} invalid row(s); nothing written:\n  ${errors.slice(0, 25).join("\n  ")}`);
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
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pool = new pg.Pool({ connectionString: url, max: 2, ssl: local ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
let written = 0;
try {
  await client.query("begin");
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await client.query(
      `insert into rwa_asset_snapshots (snapshot_date, chain, product_name, token_symbol, issuer_name, asset_class, asset_type, market_cap_usd, source)
       select x.snapshot_date::date, x.chain, x.product_name, x.token_symbol, x.issuer_name, x.asset_class, x.asset_type, x.market_cap_usd::numeric, x.source
         from jsonb_to_recordset($1::jsonb) as x(snapshot_date text, chain text, product_name text, token_symbol text, issuer_name text, asset_class text, asset_type text, market_cap_usd text, source text)
       on conflict (snapshot_date, chain, product_name, token_symbol) do update set
         issuer_name = excluded.issuer_name, asset_class = excluded.asset_class, asset_type = excluded.asset_type,
         market_cap_usd = excluded.market_cap_usd, source = excluded.source, imported_at = now()
       where (rwa_asset_snapshots.issuer_name, rwa_asset_snapshots.asset_class, rwa_asset_snapshots.asset_type, rwa_asset_snapshots.market_cap_usd)
             is distinct from (excluded.issuer_name, excluded.asset_class, excluded.asset_type, excluded.market_cap_usd)`,
      [JSON.stringify(rows.slice(i, i + 1000))]
    );
    written += r.rowCount ?? 0;
  }
  // A snapshot is exactly the file: rows present in the DB for this date but
  // not in the file (an earlier, different import of the same date) are an error.
  const check = await client.query(
    "select count(*)::int n, coalesce(sum(market_cap_usd),0)::text v from rwa_asset_snapshots where snapshot_date = $1",
    [asOf]
  );
  if (check.rows[0].n !== rows.length) throw new Error(`snapshot ${asOf} would hold ${check.rows[0].n} rows but the file has ${rows.length}; a different file was imported for this date`);
  // Exact decimal comparison (no float): both sides normalized the same way.
  if (normalizeMoney(check.rows[0].v) !== normalizeMoney(s.totalUsd)) throw new Error(`stored total ${check.rows[0].v} != file total ${s.totalUsd}`);
  await client.query("commit");
  console.log(`\nAPPLIED: ${written} row(s) inserted/changed; snapshot ${asOf} holds ${check.rows[0].n} rows, ${B(check.rows[0].v)} (exact ${check.rows[0].v}).`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(`\nFAILED, rolled back: ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
