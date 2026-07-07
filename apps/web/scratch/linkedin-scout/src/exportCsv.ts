// ---------------------------------------------------------------------------
// exportCsv.ts — Converts scraped lead JSON files to a single CSV.
//
// Usage:  npm run export
//         npm run export -- --segment segmentA
//         npm run export -- --all
//
// Outputs to data/leads.csv (or data/<segment>.csv).
// ---------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import { stringify } from "csv-stringify/sync";
import { DATA_DIR } from "./config.js";
import { banner, ensureDataDir, loadLeads, type Lead } from "./utils.js";

function parseArgs(): { segment: string | null; all: boolean } {
  const args = process.argv.slice(2);
  let segment: string | null = null;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--segment" && args[i + 1]) segment = args[++i];
    if (args[i] === "--all") all = true;
  }
  return { segment, all };
}

function getAllSegments(): string[] {
  ensureDataDir();
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

function run(): void {
  const { segment, all } = parseArgs();

  let leads: Lead[] = [];
  let outputFile: string;

  if (all || !segment) {
    const segments = getAllSegments();
    if (segments.length === 0) {
      console.log("\n⚠️  No lead data found. Run 'npm run scout' first.\n");
      process.exit(0);
    }
    for (const seg of segments) {
      leads.push(...loadLeads(seg));
    }
    outputFile = path.join(DATA_DIR, "leads_all.csv");
    banner(`Exporting all segments (${segments.join(", ")})`);
  } else {
    leads = loadLeads(segment);
    outputFile = path.join(DATA_DIR, `${segment}.csv`);
    banner(`Exporting segment: ${segment}`);
  }

  if (leads.length === 0) {
    console.log("⚠️  No leads to export.\n");
    process.exit(0);
  }

  // Deduplicate by profileUrl across segments
  const seen = new Set<string>();
  const unique = leads.filter((l) => {
    if (seen.has(l.profileUrl)) return false;
    seen.add(l.profileUrl);
    return true;
  });

  const csv = stringify(unique, {
    header: true,
    columns: [
      { key: "name", header: "Name" },
      { key: "headline", header: "Headline / Title" },
      { key: "profileUrl", header: "LinkedIn Profile URL" },
      { key: "connectionDegree", header: "Connection Degree" },
      { key: "segment", header: "Segment" },
      { key: "scrapedAt", header: "Scraped At" },
    ],
  });

  ensureDataDir();
  fs.writeFileSync(outputFile, csv);
  console.log(`📊 Exported ${unique.length} unique leads → ${outputFile}\n`);
}

run();
