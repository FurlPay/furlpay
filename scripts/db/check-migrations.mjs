#!/usr/bin/env node
// Migration hygiene gate (audit P1-1 / test T-D1).
//
//   node scripts/db/check-migrations.mjs [--base <git-ref>]
//
// Fails when:
//   1. a file in supabase/migrations is not named NNNN_snake_case.sql;
//   2. version numbers are not contiguous from 0001, or a number repeats;
//   3. a migration that exists at <base> (default: HEAD) has been modified,
//      renamed or deleted — in the working tree or in the commits since <base>.
//
// Rule 3 is the one that matters. `supabase db push` records applied versions
// and never re-runs them, so editing an applied migration changes nothing in
// any environment that already ran it, while the repository starts describing
// a schema that does not exist there. 0022 was edited this way once; the fix
// shipped as 0024. Corrections are always a NEW migration.
//
// In CI, pass --base origin/main (or the PR base SHA). Locally the default
// (HEAD) catches uncommitted edits to committed migrations.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = "supabase/migrations";
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function checkNames(files) {
  const errors = [];
  const sql = files.filter((f) => f.endsWith(".sql"));
  const versions = [];
  for (const f of sql) {
    const m = NAME.exec(f);
    if (!m) errors.push(`bad migration file name: ${f} (want NNNN_snake_case.sql)`);
    else versions.push(Number(m[1]));
  }
  versions.sort((a, b) => a - b);
  const seen = new Set();
  for (const v of versions) {
    if (seen.has(v)) errors.push(`duplicate migration number ${String(v).padStart(4, "0")}`);
    seen.add(v);
  }
  const unique = [...seen].sort((a, b) => a - b);
  unique.forEach((v, i) => {
    if (v !== i + 1) errors.push(`gap in migration sequence: expected ${String(i + 1).padStart(4, "0")}, found ${String(v).padStart(4, "0")}`);
  });
  return errors;
}

/** Parse `git diff --name-status` lines into violations for existing files. */
export function immutabilityViolations(nameStatusOutput) {
  const errors = [];
  for (const line of nameStatusOutput.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (status === "A") continue; // new migrations are how changes ship
    errors.push(`committed migration changed (${status}): ${paths.join(" -> ")} — ship the change as a new migration`);
  }
  return errors;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function main() {
  const baseIdx = process.argv.indexOf("--base");
  const base = baseIdx > -1 ? process.argv[baseIdx + 1] : "HEAD";

  const errors = checkNames(readdirSync(join(ROOT, DIR)));

  // Commits since base (only meaningful when base != HEAD) plus working tree
  // and index, all against base. --no-renames reports a rename as D + A, so a
  // renamed migration is caught as the deletion of an applied version.
  const diff = git(["diff", "--name-status", "--no-renames", base, "--", DIR]);
  errors.push(...immutabilityViolations(diff));

  if (errors.length) {
    console.error("Migration check FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const count = readdirSync(join(ROOT, DIR)).filter((f) => f.endsWith(".sql")).length;
  console.log(`Migration check OK: ${count} migrations, contiguous, none modified since ${base}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
