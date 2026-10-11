#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Regenerates the "## Documentation" section of public/llms.txt from the docs
// sidebar (src/lib/docs/nav.ts), so the two cannot drift.
//
//   node scripts/gen-llms.mjs           rewrite the section in place
//   node scripts/gen-llms.mjs --check   exit 1 if the file is out of date
//
// Only the section between the "## Documentation" heading and the next "## "
// heading is generated. Everything else in llms.txt is hand-written and must
// follow lib/productionStatus.ts; docsIntegrity.spec.ts runs the --check mode.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const NAV = join(ROOT, "src", "lib", "docs", "nav.ts");
const LLMS = join(ROOT, "public", "llms.txt");
const ORIGIN = "https://furlpay.com";
const HEADING = "## Documentation\n";

/** The nav is a TypeScript literal with one item per line; read it as text. */
export function docsSection(navSource) {
  let section = "";
  let out = "";
  for (const line of navSource.replace(/\r\n/g, "\n").split("\n")) {
    const label = /^\s*label: "([^"]+)",/.exec(line);
    if (label) section = label[1];
    const item = /title: "([^"]+)", href: "(\/docs[^"]*)", desc: "([^"]*)"/.exec(line);
    if (item) out += `- ${section} — ${item[1]}: ${ORIGIN}${item[2]}\n  ${item[3]}\n`;
  }
  if (!out) throw new Error("gen-llms: no docs entries found in nav.ts");
  return out;
}

export function render(current, navSource) {
  const text = current.replace(/\r\n/g, "\n");
  const start = text.indexOf(HEADING);
  if (start < 0) throw new Error('gen-llms: llms.txt has no "## Documentation" section');
  const bodyStart = start + HEADING.length;
  const next = text.indexOf("\n## ", bodyStart);
  if (next < 0) throw new Error("gen-llms: no section follows ## Documentation");
  return text.slice(0, bodyStart) + "\n" + docsSection(navSource) + text.slice(next);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const current = readFileSync(LLMS, "utf8");
  const next = render(current, readFileSync(NAV, "utf8"));
  if (process.argv.includes("--check")) {
    if (next !== current.replace(/\r\n/g, "\n")) {
      console.error("llms.txt is out of date with src/lib/docs/nav.ts. Run: npm run docs:llms");
      process.exit(1);
    }
    console.log("llms.txt matches the docs navigation.");
  } else {
    writeFileSync(LLMS, next);
    console.log("llms.txt documentation section regenerated.");
  }
}
