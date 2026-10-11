#!/usr/bin/env node
// Production deploy with release identity (`npm run deploy:prod`).
//
// Runs the deploy gate (check-deploy-gate.mjs) and then `vercel deploy --prod`,
// stamping the exact commit into the deployment three ways:
//   --build-env  FURLPAY_BUILD_*  (visible while building)
//   --env        FURLPAY_BUILD_*  (visible at RUNTIME: lib/ops/buildInfo.ts and
//                                  /api/ops/health read process.env when serving,
//                                  and --build-env alone does not reach that)
//   --meta       gitCommitSha / gitCommitRef (visible in `vercel inspect`)
// A CLI deploy otherwise carries no git metadata, which left the production
// commit provable only by fingerprinting responses (docs/operations/RELEASE_PROVENANCE.md).
//
// Node instead of `$(git rev-parse HEAD)` in package.json: npm runs scripts
// through cmd.exe on Windows, where command substitution does not exist.
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The vercel CLI arguments for one release. Pure, so it is testable. */
export function deployArgs({ sha, branch, time }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit SHA: ${sha}`);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch)) throw new Error(`unexpected branch name: ${branch}`);
  if (Number.isNaN(Date.parse(time))) throw new Error(`not a timestamp: ${time}`);
  const stamp = { FURLPAY_BUILD_SHA: sha, FURLPAY_BUILD_BRANCH: branch, FURLPAY_BUILD_TIME: time };
  return [
    "vercel", "deploy", "--prod", "--yes",
    ...Object.entries(stamp).flatMap(([k, v]) => ["--build-env", `${k}=${v}`, "--env", `${k}=${v}`]),
    "--meta", `gitCommitSha=${sha}`,
    "--meta", `gitCommitRef=${branch}`,
  ];
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const gate = spawnSync(process.execPath, [join(here, "check-deploy-gate.mjs")], { stdio: "inherit" });
  if (gate.status !== 0) process.exit(gate.status ?? 1);
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
  const args = deployArgs({ sha: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), time: new Date().toISOString() });
  console.log(`Deploying ${args[args.length - 3].split("=")[1]} with release identity…`);
  const res = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(res.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
