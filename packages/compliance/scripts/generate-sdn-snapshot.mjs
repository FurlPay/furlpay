#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bootstrap: Fetch the live OFAC SDN list and generate the bundled snapshot.
//
// Usage:  node scripts/generate-sdn-snapshot.mjs
//
// Writes to: src/data/ofacSdnNames.ts
// This must be run at least once before the package can be built, and should
// be re-run periodically (the SDN list updates multiple times per week).
// ---------------------------------------------------------------------------

const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ALT_URL = "https://www.treasury.gov/ofac/downloads/alt.csv";
const OUT = new URL("../src/data/ofacSdnNames.ts", import.meta.url);

// Simple CSV parser (RFC 4180).
function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      let val = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += line[i]; i++; }
      }
      fields.push(val.trim());
      if (i < line.length && line[i] === ',') i++;
    } else {
      const next = line.indexOf(',', i);
      if (next === -1) { fields.push(line.slice(i).trim()); break; }
      fields.push(line.slice(i, next).trim());
      i = next + 1;
    }
  }
  return fields;
}

function parseCSV(text) {
  return text.split(/\r?\n/).filter(l => l.trim().length > 0).map(parseCSVLine);
}

function mapType(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (t === "individual") return "individual";
  if (t === "entity") return "entity";
  if (t === "vessel") return "vessel";
  if (t === "aircraft") return "aircraft";
  return "entity";
}

const MONTH_MAP = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function extractDOB(remarks) {
  const isoM = /DOB\s+(\d{4}-\d{2}-\d{2})/i.exec(remarks);
  if (isoM) return isoM[1];
  const m = /DOB\s+(\d{2}\s+\w{3}\s+\d{4})/i.exec(remarks);
  if (!m) return undefined;
  const parts = m[1].split(/\s+/);
  if (parts.length !== 3) return undefined;
  const [day, mon, year] = parts;
  const mm = MONTH_MAP[mon.toLowerCase().slice(0, 3)];
  if (!mm) return undefined;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

function extractNationality(remarks) {
  const results = [];
  const re = /nationality\s+([A-Za-z\s]+?)(?:[;,.]|$)/gi;
  let match;
  while ((match = re.exec(remarks)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

async function main() {
  console.log("Fetching OFAC SDN list from treasury.gov...");
  const [sdnRes, altRes] = await Promise.all([fetch(SDN_URL), fetch(ALT_URL)]);
  if (!sdnRes.ok) throw new Error(`SDN fetch failed: ${sdnRes.status}`);
  if (!altRes.ok) throw new Error(`ALT fetch failed: ${altRes.status}`);

  const sdnText = await sdnRes.text();
  const altText = await altRes.text();
  console.log(`  SDN CSV: ${sdnText.length} bytes`);
  console.log(`  ALT CSV: ${altText.length} bytes`);

  const sdnRows = parseCSV(sdnText);
  const altRows = parseCSV(altText);

  // Build alias map
  const aliasMap = new Map();
  for (const row of altRows) {
    if (row.length < 4) continue;
    const entNum = row[0];
    const altName = row[3];
    if (!entNum || !altName || altName === "-0-") continue;
    const arr = aliasMap.get(entNum) ?? [];
    arr.push(altName);
    aliasMap.set(entNum, arr);
  }

  // Parse entries
  const entries = [];
  for (const row of sdnRows) {
    if (row.length < 4) continue;
    const entNum = row[0];
    const name = row[1];
    const type = row[2];
    const program = row[3];
    const remarks = row.length >= 12 ? row[11] : "";
    if (!entNum || !name || name === "-0-") continue;

    entries.push({
      entryId: `OFAC-${entNum}`,
      listSource: "OFAC_SDN",
      entityType: mapType(type),
      primaryName: name,
      aliases: aliasMap.get(entNum) ?? [],
      dateOfBirth: extractDOB(remarks),
      nationality: extractNationality(remarks),
      programs: program ? program.split(";").map(p => p.trim()).filter(Boolean) : [],
    });
  }

  console.log(`  Parsed ${entries.length} SDN entries with ${aliasMap.size} alias groups`);

  // Generate TypeScript
  const now = new Date().toISOString().slice(0, 10);
  let ts = `// AUTO-GENERATED — real OFAC SDN name entries.\n`;
  ts += `// Source: U.S. Treasury OFAC SDN list (sdn.csv + alt.csv).\n`;
  ts += `// Snapshot: ${now}. Refresh with: node scripts/generate-sdn-snapshot.mjs\n`;
  ts += `// Total entries: ${entries.length}\n`;
  ts += `//\n`;
  ts += `// This is PUBLIC U.S. government data published for compliance screening.\n`;
  ts += `// Distribution is legal and expected.\n\n`;
  ts += `import type { WatchlistName } from "../nameScreening";\n\n`;
  ts += `export const OFAC_SDN_NAMES: readonly WatchlistName[] = `;
  ts += JSON.stringify(entries, null, 2);
  ts += ` as const;\n`;

  const { writeFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  writeFileSync(fileURLToPath(OUT), ts, "utf8");
  console.log(`\nWrote ${entries.length} entries to src/data/ofacSdnNames.ts`);
}

main().catch((e) => { console.error(e); process.exit(1); });
