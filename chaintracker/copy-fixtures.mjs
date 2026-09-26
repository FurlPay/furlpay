// Copy test fixtures into the test build.
//
// tsc emits only JavaScript, so the JSON fixtures the tests read stay behind in
// src/ and every fixture-backed test fails on a missing file. Run after
// `tsc -p tsconfig.test.json`.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const from = join(root, "src");
const to = join(root, "dist-test");

let copied = 0;
for (const rel of globSync("**/fixtures/**/*.json", { cwd: from })) {
  const src = join(from, rel);
  const dst = join(to, rel);
  if (!existsSync(dirname(dst))) mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  copied += 1;
}
console.log(`fixtures copied: ${copied}`);
