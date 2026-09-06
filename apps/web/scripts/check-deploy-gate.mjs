#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Refuse to deploy a commit that CI has not passed.
//
// WHY THIS EXISTS. AGENTS.md: "Deploys manually to Vercel prod
// (`npx vercel deploy --prod --yes` from repo root); pushing to GitHub does NOT
// deploy." So the CI workflow — lint, tsc, the route-security invariants, 3,100
// unit tests and a full `next build` — is advisory to the thing that actually
// ships. ci.yml's own header records the consequence: commits 024b84b and
// 941ab52 shipped a lint error that broke two production deployments while
// `tsc --noEmit` and the unit tests stayed green, because neither had run.
//
// A human running one command cannot be relied on to remember to check a run
// first, so this is the command. Put it in front of the deploy:
//
//   npm run predeploy && npx vercel deploy --prod --yes
//
// WHAT IT CHECKS, in order of how cheaply it can say no:
//   1. The working tree is clean. Deploying uncommitted work ships something
//      that exists on exactly one laptop and is in no commit anybody can
//      bisect, revert or review.
//   2. HEAD is pushed. A green run cannot exist for a SHA the remote has
//      never seen.
//   3. GitHub reports the CI workflow SUCCESS for this exact SHA. Not the
//      branch, not the latest run — this commit. A green run on the commit
//      before yours says nothing about yours.
//
// ESCAPE HATCH, deliberately loud: FURLPAY_DEPLOY_FORCE=1 skips the checks and
// prints why that is a bad idea. Incidents happen and a hotfix sometimes has to
// go out ahead of a queue; the flag makes that a decision somebody typed rather
// than a default nobody noticed.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

const WORKFLOW = "CI";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message, remedy) {
  console.error(`\n  DEPLOY BLOCKED — ${message}\n`);
  if (remedy) console.error(`  ${remedy}\n`);
  process.exit(1);
}

if (process.env.FURLPAY_DEPLOY_FORCE === "1") {
  console.warn(
    "\n  FURLPAY_DEPLOY_FORCE=1 — deploying WITHOUT a verified CI run.\n" +
      "  Nothing has checked that this commit lints, type-checks, passes the route-security\n" +
      "  invariants, or builds. Use only for an incident hotfix, and follow up with a real run.\n"
  );
  process.exit(0);
}

// ── 1. Clean tree ──────────────────────────────────────────────────────────
const dirty = git("status", "--porcelain", "--untracked-files=no");
if (dirty) {
  fail(
    "the working tree has uncommitted changes",
    "Commit or stash them. A deploy from a dirty tree ships code that is in no commit."
  );
}

const sha = git("rev-parse", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");

// ── 2. Pushed ──────────────────────────────────────────────────────────────
let remoteSha = "";
try {
  const line = execFileSync("git", ["ls-remote", "origin", branch], { encoding: "utf8" }).trim();
  remoteSha = line.split(/\s+/)[0] ?? "";
} catch {
  fail("could not reach the git remote", "Check your network and credentials, then retry.");
}
if (!remoteSha) {
  fail(`branch ${branch} does not exist on origin`, `Run: git push -u origin ${branch}`);
}
if (remoteSha !== sha) {
  fail(
    `HEAD (${sha.slice(0, 8)}) is not what origin/${branch} points at (${remoteSha.slice(0, 8)})`,
    "Push first — CI cannot have run against a commit the remote has never seen."
  );
}

// ── 3. A green CI run for THIS sha ─────────────────────────────────────────
let runs;
try {
  const json = execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--commit",
      sha,
      "--json",
      "status,conclusion,databaseId,headSha,url",
      "--limit",
      "20",
    ],
    { encoding: "utf8" }
  );
  runs = JSON.parse(json);
} catch (e) {
  fail(
    "could not query GitHub Actions",
    "Install and authenticate the GitHub CLI (`gh auth login`), or set FURLPAY_DEPLOY_FORCE=1 " +
      "if you are knowingly deploying without a verified run.\n  " +
      String(e.message ?? e).split("\n")[0]
  );
}

// Filter defensively: `--commit` should already scope this, but a deploy gate
// that trusts a filter it did not apply itself is not much of a gate.
const forThisSha = runs.filter((r) => r.headSha === sha);
if (forThisSha.length === 0) {
  fail(
    `no ${WORKFLOW} run exists for ${sha.slice(0, 8)}`,
    "Wait for the run triggered by your push, or trigger one, then retry."
  );
}

const inProgress = forThisSha.find((r) => r.status !== "completed");
if (inProgress) {
  fail(
    `the ${WORKFLOW} run for ${sha.slice(0, 8)} is still ${inProgress.status}`,
    `Wait for it to finish: ${inProgress.url}`
  );
}

const green = forThisSha.find((r) => r.conclusion === "success");
if (!green) {
  const worst = forThisSha[0];
  fail(
    `${WORKFLOW} did not pass for ${sha.slice(0, 8)} (conclusion: ${worst.conclusion})`,
    `Fix it and push again: ${worst.url}`
  );
}

console.log(`  CI passed for ${sha.slice(0, 8)} on ${branch} — ${green.url}`);
console.log("  Safe to deploy.\n");
