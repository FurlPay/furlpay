#!/usr/bin/env node
// Fails when a GitHub Actions workflow (or composite action) references an
// action by a mutable ref (tag or branch) instead of a full commit SHA
// (SEC-P4-001). A tag can be moved to different code after review; a SHA
// cannot. Local actions (`uses: ./...`) and docker:// images are out of scope.
//
//   node scripts/security/check-actions-pinned.mjs

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every mutable `uses:` reference in the given YAML text. */
export function mutableRefs(yaml) {
  const out = [];
  const lines = yaml.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^\s*-?\s*uses:\s*["']?([^\s"'#]+)/);
    if (!m) return;
    const ref = m[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) return;
    const at = ref.lastIndexOf("@");
    if (at < 0 || !/^[0-9a-f]{40}$/.test(ref.slice(at + 1))) out.push({ line: i + 1, ref });
  });
  return out;
}

function yamlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return yamlFiles(p);
    return /\.ya?ml$/.test(name) ? [p] : [];
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const files = yamlFiles(join(ROOT, ".github"));
  const problems = files.flatMap((f) => mutableRefs(readFileSync(f, "utf8")).map((r) => `${relative(ROOT, f)}:${r.line}  ${r.ref}`));
  if (problems.length) {
    console.error(`Actions must be pinned to a full commit SHA (append "# vX" for readability):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`All action references in ${files.length} workflow files are SHA-pinned.`);
}
