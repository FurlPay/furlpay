#!/usr/bin/env node
// Generates the external-audit scoping pack (docs/security/AUDIT-SCOPING-PACK.md)
// from the repository itself: the exact commit, every in-scope component with
// file and SLOC counts, the on-chain code file by file, existing security
// controls, and the internal audit documents an auditor should read first.
//
//   node scripts/security/scoping-pack.mjs            # write the file
//   node scripts/security/scoping-pack.mjs --check    # exit 1 if it is stale
//
// Everything is derived from `git ls-files` at HEAD, so the numbers describe
// committed code only, never a dirty working tree. SLOC = non-blank lines that
// are not comments (line and block comments stripped per language).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "security", "AUDIT-SCOPING-PACK.md");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

// ── Components ──────────────────────────────────────────────────────────────
// `paths` are git pathspecs; `exts` the source languages counted. Tests,
// generated code and vendored files are reported separately, not as SLOC.
export const COMPONENTS = [
  { id: "contracts", name: "EVM smart contracts", paths: ["packages/contracts/contracts"], exts: [".sol"], priority: "Critical", services: "Smart contract audit; formal verification of fund-moving paths" },
  { id: "solana", name: "Solana escrow program (Anchor)", paths: ["furlpay-programs/programs"], exts: [".rs"], priority: "Critical", services: "Smart contract audit (Rust/Anchor)" },
  { id: "web", name: "Web app + payment API (Next.js)", paths: ["apps/web/src"], exts: [".ts", ".tsx"], priority: "High", services: "Web + API penetration test; business-logic review of settlement and payouts" },
  { id: "extension", name: "Browser extension (MV3)", paths: ["apps/extension"], exts: [".ts", ".tsx"], priority: "High", services: "Browser-extension penetration test" },
  { id: "mobile", name: "Mobile app (React Native)", paths: ["native-app"], exts: [".ts", ".tsx"], priority: "Medium", services: "Mobile penetration test (Android/iOS)" },
  { id: "ios", name: "iOS + watchOS app (Swift)", paths: ["ios"], exts: [".swift"], priority: "Medium", services: "Mobile penetration test (iOS)" },
  { id: "android", name: "Android + Wear OS app (Kotlin)", paths: ["guardian"], exts: [".kt"], priority: "Medium", services: "Mobile penetration test (Android)" },
  { id: "sdks", name: "Merchant SDKs", paths: ["sdks"], exts: [".ts", ".py", ".go", ".rs"], priority: "Medium", services: "SDK review (signing, webhook verification, dependencies)" },
  { id: "packages", name: "Shared packages (gateway, x402-guard, settlement, ...)", paths: ["packages"], exts: [".ts", ".tsx"], exclude: ["packages/contracts/"], priority: "High", services: "Code review with the web/API scope" },
  { id: "mcp", name: "MCP server (agent payments)", paths: ["mcp"], exts: [".ts", ".js"], priority: "High", services: "API penetration test; AI/agent abuse cases" },
  { id: "infra", name: "AWS infrastructure (Terraform)", paths: ["infra"], exts: [".tf"], priority: "High", services: "Cloud configuration review (IAM, network, secrets)" },
];

const TEST_RE = /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|mocks?)\/|\.(spec|test)\.[a-z]+$|Tests?\.(swift|kt)$/i;
const SKIP_RE = /(^|\/)(node_modules|dist|build|\.next|generated|vendor|lib\/forge-std|typechain-types)\//;
// Bundled datasets (e.g. the OFAC SDN name list) are data, not logic: listed
// in their own section, never counted as audit SLOC.
const DATA_RE = /(^|\/)src\/data\//;

/** Non-blank, non-comment lines. Handles //, /* *\/ and # comment styles. */
export function sloc(source, ext) {
  const hash = ext === ".py" || ext === ".tf";
  const slash = ext !== ".py";
  let inBlock = false;
  let count = 0;
  for (const raw of source.split(/\r?\n/)) {
    let line = raw.trim();
    if (slash) {
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end < 0) continue;
        line = line.slice(end + 2).trim();
        inBlock = false;
      }
      while (line.includes("/*")) {
        const start = line.indexOf("/*");
        const end = line.indexOf("*/", start + 2);
        if (end < 0) {
          line = line.slice(0, start).trim();
          inBlock = true;
          break;
        }
        line = (line.slice(0, start) + line.slice(end + 2)).trim();
      }
      if (line.startsWith("//")) continue;
    }
    if (hash && line.startsWith("#")) continue;
    if (line) count++;
  }
  return count;
}

function filesFor(c) {
  const listed = git("ls-files", "--", ...c.paths).split("\n").filter(Boolean);
  return listed.filter(
    (f) => c.exts.includes(extname(f)) && !SKIP_RE.test(f) && !DATA_RE.test(f) && !(c.exclude ?? []).some((x) => f.startsWith(x)),
  );
}

function measure(c) {
  const files = filesFor(c);
  let src = 0, srcFiles = 0, test = 0, testFiles = 0;
  const perFile = [];
  for (const f of files) {
    const n = sloc(readFileSync(join(ROOT, f), "utf8"), extname(f));
    if (TEST_RE.test(f)) {
      test += n;
      testFiles++;
    } else {
      src += n;
      srcFiles++;
      perFile.push({ file: f, sloc: n });
    }
  }
  return { ...c, src, srcFiles, test, testFiles, perFile };
}

const fmt = (n) => n.toLocaleString("en-US");

function routeManifestCounts() {
  const p = join(ROOT, "apps/web/security/route-manifest.json");
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, "utf8"));
  return { total: m._total, counts: m._counts };
}

function workflows() {
  return git("ls-files", "--", ".github/workflows")
    .split("\n")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => f.replace(".github/workflows/", ""));
}

function internalAudits() {
  return git("ls-files", "--", "audit", "docs/audit")
    .split("\n")
    .filter((f) => /\.md$/i.test(f))
    .sort();
}

export function render() {
  const commit = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const remote = git("remote", "get-url", "origin").replace(/\.git$/, "");
  const committed = git("show", "-s", "--format=%cI", "HEAD");
  const rows = COMPONENTS.map(measure);
  const onchain = rows.filter((r) => r.id === "contracts" || r.id === "solana");
  const manifest = routeManifestCounts();

  const L = [];
  L.push("# External security audit: scoping pack");
  L.push("");
  L.push("<!-- Generated by scripts/security/scoping-pack.mjs. Do not edit by hand; re-run the script. -->");
  L.push("");
  L.push("Prepared for an external auditor's scoping call (smart contracts, penetration test, cloud review).");
  L.push("Every figure below is computed from committed code at the commit shown.");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| Repository | ${remote} |`);
  L.push(`| Branch | \`${branch}\` |`);
  L.push(`| Commit | \`${commit}\` |`);
  L.push(`| Commit date | ${committed} |`);
  L.push("");
  L.push("SLOC = non-blank, non-comment source lines. Test code is counted separately and is not part of the audit SLOC.");
  L.push("");
  L.push("## 1. Components in scope");
  L.push("");
  L.push("| Component | Paths | Language | Files | SLOC | Test SLOC | Priority | Suggested service |");
  L.push("|---|---|---|---:|---:|---:|---|---|");
  for (const r of rows) {
    L.push(
      `| ${r.name} | ${r.paths.map((p) => `\`${p}\``).join(", ")} | ${r.exts.join(" ")} | ${fmt(r.srcFiles)} | ${fmt(r.src)} | ${fmt(r.test)} | ${r.priority} | ${r.services} |`,
    );
  }
  const total = rows.reduce((a, r) => a + r.src, 0);
  L.push(`| **Total** | | | ${fmt(rows.reduce((a, r) => a + r.srcFiles, 0))} | **${fmt(total)}** | ${fmt(rows.reduce((a, r) => a + r.test, 0))} | | |`);
  L.push("");
  L.push("## 2. On-chain code, file by file");
  L.push("");
  L.push("Smart-contract audits are quoted on SLOC; this is the list to send.");
  L.push("");
  for (const r of onchain) {
    L.push(`### ${r.name}: ${fmt(r.src)} SLOC`);
    L.push("");
    L.push("| File | SLOC |");
    L.push("|---|---:|");
    for (const f of [...r.perFile].sort((a, b) => b.sloc - a.sloc)) L.push(`| \`${f.file}\` | ${fmt(f.sloc)} |`);
    L.push("");
  }
  const data = git("ls-files").split("\n").filter((f) => DATA_RE.test(f) && /\.(ts|js|json)$/.test(f));
  if (data.length) {
    L.push("### Bundled datasets (excluded from SLOC)");
    L.push("");
    L.push("| File | Lines |");
    L.push("|---|---:|");
    for (const f of data) L.push(`| \`${f}\` | ${fmt(readFileSync(join(ROOT, f), "utf8").split(/\r?\n/).length)} |`);
    L.push("");
  }
  L.push("## 3. Existing security controls");
  L.push("");
  L.push("- Mandatory API security rules: `AGENTS.md` (Zod body validation, rate limits on public routes, HMAC-verified webhooks, no mass assignment, secret stripping, CSPRNG only, address validation, oracle sanity bounds).");
  if (manifest) {
    L.push(`- Route manifest: ${fmt(manifest.total)} API handlers, each classified by auth model and enforced in CI (\`apps/web/security/route-manifest.json\`):`);
    for (const [k, v] of Object.entries(manifest.counts)) L.push(`  - ${k}: ${v}`);
  }
  L.push(`- CI workflows (${workflows().length}): ${workflows().map((w) => `\`${w}\``).join(", ")}.`);
  L.push("");
  L.push("## 4. Internal audits to read first");
  L.push("");
  L.push("Prior internal reviews and their remediation records. These are internal, not third-party, audits.");
  L.push("");
  for (const f of internalAudits()) L.push(`- \`${f}\``);
  L.push("");
  L.push("## 5. Still to supply by hand");
  L.push("");
  L.push("Not derivable from the repository; fill in before the call:");
  L.push("");
  L.push("- [ ] Architecture diagram (on-chain and off-chain trust boundaries)");
  L.push("- [ ] Which networks each contract is, or will be, deployed to, with addresses");
  L.push("- [ ] Cloud accounts, IAM model and which Terraform environments are live");
  L.push("- [ ] Target compliance frameworks (e.g. MiCA, DORA, SOC 2, ISO 27001)");
  L.push("- [ ] Priority attack scenarios and any deadlines");
  L.push("- [ ] Whether formal verification is wanted, and for which functions");
  L.push("");
  return L.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const next = render();
  if (process.argv.includes("--check")) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    // The commit line changes on every commit; compare everything else.
    const strip = (s) => s.replace(/^\| (Commit|Commit date|Branch) \|.*$/gm, "");
    if (strip(current) !== strip(next + "\n")) {
      console.error("docs/security/AUDIT-SCOPING-PACK.md is stale: run node scripts/security/scoping-pack.mjs");
      process.exit(1);
    }
    console.log("scoping pack is current");
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, next + "\n");
    console.log(`wrote ${OUT.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
  }
}
