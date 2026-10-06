#!/usr/bin/env node
// Regenerates apps/web/src/lib/travel/airportsData.json from OurAirports
// (https://ourairports.com/data/, public domain).
//
//   curl -L -o airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node scripts/travel/build-airports.mjs airports.csv
//
// Keeps airports an airline can sell a ticket to: an IATA code, scheduled
// passenger service, and type large/medium/small airport (seaplane bases,
// heliports and closed fields are dropped). Output rows are
// [iata, name, city, isoCountry, size, keywords] where size is 3/2/1 for
// large/medium/small, used to rank search results.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web", "src", "lib", "travel", "airportsData.json");

/** RFC 4180 line parser (quoted fields may contain commas). */
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const SIZE = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const src = process.argv[2];
if (!src) { console.error("usage: node build-airports.mjs <airports.csv>"); process.exit(2); }
const lines = readFileSync(src, "utf8").split(/\r?\n/);
const head = parseLine(lines[0]);
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const seen = new Set();
const rows = [];
for (const line of lines.slice(1)) {
  if (!line) continue;
  const r = parseLine(line);
  const iata = r[col.iata_code];
  const size = SIZE[r[col.type]];
  if (!size || r[col.scheduled_service] !== "yes" || !/^[A-Z]{3}$/.test(iata) || seen.has(iata)) continue;
  seen.add(iata);
  // keywords carry metro names ("Tokyo" for NRT, "NYC" for EWR) — kept short.
  const kw = (r[col.keywords] || "").split(",").map((k) => k.trim()).filter((k) => k && k.length <= 40 && !/^[A-Z0-9]{4}$/.test(k)).slice(0, 4).join(",");
  rows.push([iata, r[col.name], r[col.municipality] || "", r[col.iso_country], size, kw]);
}
rows.sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0]));
writeFileSync(OUT, JSON.stringify(rows));
console.log(`${rows.length} airports -> ${OUT} (${(JSON.stringify(rows).length / 1024).toFixed(0)} KB)`);
