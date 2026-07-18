#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Route security-invariant scanner (AGENTS.md rules 1 & 2).
//
// Static check across every apps/web API route handler. Catches the two
// mandatory invariants Semgrep's generic rules don't know about:
//
// Two severities so the output is honest, not alarmist:
//
//   FAIL (exit 1) — a mutating handler READS a body and applies NO validation
//                   of any kind (no Zod, no typeof/Number/enum/regex guard, no
//                   cryptographic verify). This is the class that lets
//                   `amountUsd: -100000` reach a balance mutation.
//                   Also FAIL: a SENSITIVE public route (auth, money, or a
//                   provider-cost endpoint) with no per-route rateLimitOr429().
//
// NOTE on rate limiting: src/middleware.ts already applies a Redis-backed
// baseline of 150 mutating req/min/IP to every /api route except /api/webhooks.
// So a missing rateLimitOr429() is NOT "unthrottled" — it means no TIGHTER
// budget. That is only a real defect where the baseline is far too generous:
// credential brute-force, money movement, and endpoints that mint third-party
// objects (Stripe intents) or send email/SMS. Everything else is advisory.
//
//   WARN (advisory) — the handler validates, but MANUALLY (typeof / Number /
//                   enum / regex / crypto-verify) instead of the canonical Zod
//                   parse()/validateBody(). Not a vulnerability; a convention
//                   nudge. Webhooks (HMAC-verified raw bodies) are exempt.
//
// Text-based on purpose: it mirrors how a reviewer greps a route, has no
// build/runtime cost, and runs in CI. In-file signals only — a route that
// validates in an imported helper the scanner can't see should add an inline
// // security-scan: <reason> allow-list comment.
//
//   node apps/web/scripts/check-route-security.mjs
//   exit 0 = no FAILs (WARNs allowed), exit 1 = at least one FAIL.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(SCRIPT_DIR, "..", "src", "app", "api");
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", "..");

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

/** Recursively collect every route.ts under the API root. */
function routeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts" || name === "route.tsx") out.push(full);
  }
  return out;
}

/** Which HTTP methods this file exports a handler for. Matches both
 *  `export function POST()` / `export async function POST()` and
 *  `export const POST = ...`. */
function exportedMethods(src) {
  const methods = new Set();
  const re = /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let m;
  while ((m = re.exec(src))) methods.add(m[1]);
  return methods;
}

const has = (src, re) => re.test(src);

function analyze(file) {
  const src = readFileSync(file, "utf8");
  const methods = exportedMethods(src);
  const mutating = MUTATING.filter((m) => methods.has(m));
  if (mutating.length === 0) return null; // read-only route — out of scope here

  const allow = src.match(/\/\/\s*security-scan:\s*(.+)/i)?.[1]?.trim();

  const readsBody = has(src, /\breq(?:uest)?\.(?:json|formData|text)\s*\(/);
  const zodValidated = has(src, /\b(?:parse|validateBody|safeParse)\s*\(/) || has(src, /\.(?:parse|safeParse)\s*\(/);
  // Auth helpers (authz.ts requireUser/requireRole, ops/respond requireOpsAdmin,
  // any require*Admin), or a direct session verify. `assertRail*` is a pause
  // gate, NOT auth — deliberately excluded.
  const authed =
    has(src, /\brequire(?:User|Role|Agent|OpsAdmin|Session|Mcp|Operator)\s*\(/) ||
    has(src, /\brequire\w*Admin\s*\(/) ||
    has(src, /\bverifySession\s*\(/);
  const rateLimited = has(src, /\brateLimit(?:Or429)?\s*\(/);
  const isWebhook =
    /[\\/]webhooks?[\\/]/.test(file) ||
    /[\\/](?:interactions|telegram)[\\/]/.test(file) ||
    has(src, /\b(?:timingSafeEqual|endpointSecret|createHmac|verifyWebhook|webhookGuard|constantTimeEqual|verifyKey|nacl|Ed25519)\b/) ||
    has(src, /secret-token/i);
  // Any manual validation signal: numeric/typeof/enum/regex guards, primitive
  // coercion (Number()/BigInt()/String()), or a cryptographic verification of
  // the payload (Google/Apple token, WebAuthn, x402 authorization, address
  // parse). Presence means the body is guarded even without Zod — advisory.
  const manualGuard = has(
    src,
    /\bNumber\s*[.(]|\bBigInt\s*\(|\bString\s*\(|\btypeof\s|\binstanceof\s|===\s*["']|\.test\s*\(|\bnew PublicKey\s*\(|\bverify[A-Z]\w*\s*\(|\bscreenAddress\s*\(|\bz\.\w+\s*\(/
  );

  const fails = [];
  const warns = [];
  if (readsBody && !zodValidated && !manualGuard && !isWebhook && !allow) {
    fails.push({ rule: "BODY_UNGUARDED", detail: `${mutating.join("/")} reads a body with NO validation of any kind` });
  } else if (readsBody && !zodValidated && !isWebhook && !allow) {
    warns.push({ rule: "BODY_MANUAL_VALIDATION", detail: `${mutating.join("/")} validates manually — prefer Zod parse()/validateBody()` });
  }
  if (!authed && !isWebhook && !rateLimited && !allow) {
    const rel = relative(API_ROOT, file).replace(/\\/g, "/");
    // Sensitive = credential/auth surfaces, money movement, and endpoints that
    // cost us money per call (third-party object creation, email/SMS).
    const sensitive =
      /^(auth|payments|cards|wallets|transfers|swaps|earn|account|offramp|onramp|credit|escrow)\//.test(rel) ||
      /^compliance\/(kyc|attestation)/.test(rel) ||
      /^(newsletter|careers|contact|ambassadors|support|hackathon|early-access|swag)\//.test(rel);
    const entry = {
      rule: "PUBLIC_NO_RATELIMIT",
      detail: `public ${mutating.join("/")} relies on the 150/min middleware baseline only`,
    };
    if (sensitive) fails.push(entry);
    else warns.push(entry);
  }

  return { file: relative(REPO_ROOT, file).replace(/\\/g, "/"), fails, warns };
}

const results = routeFiles(API_ROOT).map(analyze).filter(Boolean);
const failing = results.filter((r) => r.fails.length > 0);
const warning = results.filter((r) => r.warns.length > 0);

console.log(`Scanned ${results.length} routes with a mutating handler.`);
console.log(`  ${failing.length} FAIL  ·  ${warning.length} WARN (advisory)\n`);

if (failing.length > 0) {
  console.log(`❌ FAIL — no validation / no rate limit:\n`);
  for (const r of failing) {
    console.log(`  ${r.file}`);
    for (const v of r.fails) console.log(`     [${v.rule}] ${v.detail}`);
  }
  console.log("");
}

if (warning.length > 0) {
  console.log(`⚠️  WARN — validated manually, not via Zod (convention nudge, not a hole):\n`);
  for (const r of warning) console.log(`  ${r.file}  [${r.warns[0].rule}]`);
  console.log("");
}

if (failing.length === 0) {
  console.log("✅ No unguarded bodies and no unthrottled public writes.");
  process.exit(0);
}
console.log(
  `Fix FAILs: add a guard (Zod parse()/validateBody() preferred) for bodies,\n` +
    `rateLimitOr429() for public writes. Out-of-file handling → // security-scan: <reason>\n`
);
process.exit(1);
