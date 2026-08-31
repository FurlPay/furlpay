// ---------------------------------------------------------------------------
// Carry the CSV's `source` column into the dataset.
//
//   npx tsx apps/web/scripts/backfill-source-note.mts
//
// WHY THIS WAS MISSED AND WHY IT MATTERS. A column-by-column audit of the CSV
// against the resolved dataset found every one of the 507 rows present and all
// 22 mapped fields matching exactly — and two columns not carried at all.
//
//   source_url  identical to `website` in all 507 rows. Genuinely redundant,
//               and correctly dropped.
//   source      three distinct values, and one of them is load-bearing:
//               58 rows say "Property publicly documented; official URL to be
//               confirmed", and those are exactly the 58 rows with no website.
//
// That second one explains a gap rather than filling one. Without it a missing
// website reads as an oversight in the data; with it, it is a recorded state —
// and it is also the reason the resolver could not use a domain match on those
// rows, which is the single strongest signal it has. Carrying it turns "why did
// this property resolve weakly?" into a question the dataset can answer.
//
// A BACKFILL RATHER THAN A RE-RUN, because re-resolving 507 properties to add
// one string would spend ~600 billed Places calls to move data that never left
// the CSV. The resolver writes this field on its next real run; this brings the
// existing artifact up to date without paying for it twice.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CuratedDataset } from "../src/lib/hotels/curatedTypes";
import { openDataset } from "./lib/dataset.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const CSV_PATH = path.resolve(
  flag("csv") ?? path.join(REPO_ROOT, "furlpay_global_luxury_map_properties.csv")
);
const IN_PATH = path.resolve(
  flag("in") ?? path.join(WEB_ROOT, "src", "data", "luxury-properties.json")
);

/** Same RFC 4180 parse the resolver uses; the file has quoted commas in every
 *  description and nothing more exotic. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.length > 1 && r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
const noteByName = new Map(rows.map((r) => [r.property_name, r.source]));

const held = openDataset<CuratedDataset>(IN_PATH, "backfill-source-note");
const dataset = held.data;

let applied = 0;
let unmatched = 0;
dataset.properties = dataset.properties.map((p) => {
  const note = noteByName.get(p.name);
  if (!note) {
    unmatched++;
    return p;
  }
  applied++;
  return { ...p, sourceNote: note };
});

held.commit(dataset);

const tally = new Map<string, number>();
for (const p of dataset.properties) {
  if (p.sourceNote) tally.set(p.sourceNote, (tally.get(p.sourceNote) ?? 0) + 1);
}

console.log(`csv        ${CSV_PATH}`);
console.log(`dataset    ${IN_PATH}`);
console.log(`applied    ${applied}/${dataset.properties.length}${unmatched ? `, ${unmatched} unmatched` : ""}`);
for (const [note, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${note}`);
}

// The claim this backfill rests on, checked rather than asserted.
const noUrlNote = dataset.properties.filter(
  (p) => p.sourceNote === "Property publicly documented; official URL to be confirmed"
);
const alsoNoWebsite = noUrlNote.filter((p) => !p.website).length;
console.log("");
console.log(
  `cross-check: ${alsoNoWebsite}/${noUrlNote.length} rows noted "URL to be confirmed" do indeed have no website`
);
