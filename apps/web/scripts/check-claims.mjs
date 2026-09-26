#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CLAIMS LINTER — refuses a build that advertises a capability production does
// not have.
//
// WHY IT EXISTS. On 19 Sep 2026 Circle rejected FurlPay's Alliance listing
// because the marketing surface described x402 agent payments, tokenized-stock
// trading and mobile apps that a reviewer could not exercise, while the site's
// own rail widget reported "Not configured" on the same page. Fixing the pages
// by hand fixes that day. It does not stop the next page — or the next
// campaign, or the next locale variant of /pricing — from reintroducing the
// same sentence, because nothing in the build ever objected.
//
// HOW IT DECIDES. Each rule pairs a phrase that reads as a shipped capability
// with the capability it implies. A match is a violation UNLESS a qualifier
// appears within QUALIFIER_WINDOW characters of it — "in development", "coming
// soon", "not yet", "pending", "planned", "roadmap". So the roadmap can still
// be described in full; it just cannot be described in the present tense
// without the qualifier beside it.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not read lib/productionStatus.ts to
// decide which capabilities are live. The statuses there are edited by the same
// person editing the page, so deriving the rules from them would let one commit
// "fix" a violation by promoting the capability. The list below is a fixed
// inventory of what is NOT live as of 22 Sep 2026 — moving a capability out of
// it is a deliberate, reviewable act that should happen on the day the
// credential lands in production, not the day the copy is written.
//
// Scope is the PUBLIC surface: marketing pages, landing sections, docs pages.
// Blog posts are dated, first-person accounts of what was built and are
// excluded — rewriting them would be falsifying a record rather than correcting
// a claim.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const SCAN_DIRS = ["src/app", "src/components/marketing", "src/components/landing"];

// Paths under SCAN_DIRS that are exempt, each with the reason.
const EXCLUDE = [
  // Dated first-person posts. A historical account of building something is
  // not a claim that it is live today.
  "src/app/blog",
  "src/lib/blog",
  // The changelog records what shipped on a date, in the past tense.
  "src/app/changelog",
  // A glossary defines industry terms; defining "gasless transfer" is not
  // offering one.
  "src/app/learn",
  // API route handlers are not prose. Their honesty is enforced by tests and
  // by fail-closed guards, not by phrase matching.
  "src/app/api",
];

const QUALIFIER_WINDOW = 320;

const QUALIFIERS = [
  "in development",
  "coming soon",
  "not yet",
  "not available",
  "no card program",
  "pending",
  "planned",
  "roadmap",
  "will be",
  "when it ships",
  "when they ship",
  "when it opens",
  "awaiting",
  "not configured",
  "NOT_CONFIGURED",
  "in final testing",
  "concept preview",
  "is being built",
  "are being built",
  "have not launched",
  "has not launched",
  "cannot yet",
  "does not",
  "do not",
  "not live",
  "not enabled",
  "unavailable",
  "soon",
];

/**
 * Phrases that assert a capability production does not have.
 *
 * Each entry is deliberately a PHRASE rather than a keyword. "trading" alone
 * matches market-data copy that is perfectly true; "start trading" does not.
 * A rule that fires on true sentences gets suppressed rather than obeyed.
 */
const RULES = [
  { id: "cards", phrases: ["issue a virtual card", "virtual visa", "your furlpay card", "card is live", "order your card"] },
  { id: "banking", phrases: ["open a local account", "global local accounts", "your iban", "local accounts are live"] },
  { id: "trading", phrases: ["start trading", "buy fractional shares", "place an order", "fractional stock investing", "invest in us stocks today"] },
  { id: "tokenized", phrases: ["trade tokenized stocks", "tokenized equities are live"] },
  { id: "travel", phrases: ["book your stay", "book a hotel and pay", "book stays and flights and pay", "travel platform is live", "bookable stays"] },
  { id: "gasless", phrases: ["gasless transfers are live", "zero gas fees", "no gas fees", "gas-free transfers"] },
  { id: "x402-settle", phrases: ["agents pay per call", "x402 settlement is live", "settles on arbitrum today", "agent payments are live"] },
  { id: "mobile", phrases: ["download on the app store", "get it on google play", "available on the app store", "available on google play"] },
  { id: "desktop", phrases: ["desktop client", "download the desktop app"] },
  { id: "settlement", phrases: ["we settle your payments", "funds settle to your account", "settlement is live"] },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|mdx)$/.test(entry)) out.push(full);
  }
  return out;
}

function isExcluded(relPath) {
  const normalised = relPath.split(sep).join("/");
  return EXCLUDE.some((prefix) => normalised.startsWith(prefix));
}

/**
 * Collapse every run of whitespace to one space, keeping a map back to the
 * original offsets so a violation can still be reported at its real line.
 *
 * WHY THIS IS NECESSARY. JSX prose wraps at 100 columns, so "in development"
 * routinely arrives as "in\n              development". Matching the raw text
 * made the linter blind in both directions: it missed claims that straddled a
 * line break, and — worse — it rejected copy that HAD been qualified, because
 * the qualifier happened to wrap. A linter that fires on correct text is a
 * linter people learn to skip.
 */
function normalise(source) {
  let text = "";
  const offsets = [];
  let inSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (!inSpace) {
        text += " ";
        offsets.push(i);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    text += ch;
    offsets.push(i);
  }
  return { text, offsets };
}

/** True when a qualifier sits close enough to the match to govern it. */
function qualified(haystack, index, length) {
  const from = Math.max(0, index - QUALIFIER_WINDOW);
  const to = Math.min(haystack.length, index + length + QUALIFIER_WINDOW);
  const window = haystack.slice(from, to).toLowerCase();
  return QUALIFIERS.some((q) => window.includes(q.toLowerCase()));
}

const violations = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (isExcluded(rel)) continue;
    const source = readFileSync(file, "utf8");
    const { text, offsets } = normalise(source);
    const lower = text.toLowerCase();

    for (const rule of RULES) {
      for (const phrase of rule.phrases) {
        let from = 0;
        for (;;) {
          const at = lower.indexOf(phrase, from);
          if (at === -1) break;
          from = at + phrase.length;
          if (qualified(text, at, phrase.length)) continue;
          const line = source.slice(0, offsets[at] ?? 0).split("\n").length;
          violations.push({ file: rel.split(sep).join("/"), line, rule: rule.id, phrase });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\nUnqualified production claims found.\n");
  console.error(
    "Each line below advertises a capability that is NOT live in production, with no\n" +
      'qualifier ("in development", "coming soon", "not yet", …) within ' +
      QUALIFIER_WINDOW +
      " characters.\n" +
      "Either reword the claim or, if the capability genuinely shipped, remove its rule\n" +
      "from scripts/check-claims.mjs in the same commit that ships it.\n"
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]  "${v.phrase}"`);
  }
  console.error(`\n${violations.length} violation(s).\n`);
  process.exit(1);
}

console.log(`Claims linter: no unqualified production claims (${RULES.length} rules).`);
