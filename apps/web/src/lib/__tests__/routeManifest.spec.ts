// CI enforcement for the API authentication-model manifest.
//
// The recurring FP-2..FP-5 bug class was "a route silently operating without a
// properly resolved principal." This test makes that impossible to add
// unnoticed: every API handler MUST have an explicit classification in
// security/route-manifest.json, and the manifest MUST NOT drift from disk.
//
// If you add a new route.ts, this test fails until you classify it. If you
// delete one, it fails until you remove the stale manifest entry. Zero UNKNOWN
// is the invariant.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // src/lib/__tests__
const API_DIR = join(HERE, "..", "..", "app", "api"); // src/app/api
const MANIFEST = join(HERE, "..", "..", "..", "security", "route-manifest.json");

const VALID_CLASSES = [
  "AUTHENTICATED_USER",
  "ADMIN_ONLY",
  "WEBHOOK_VERIFIED",
  "PUBLIC_INTENTIONAL",
  "DEVELOPMENT_ONLY",
  "INTERNAL_ONLY",
] as const;

function liveRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...liveRoutes(p));
    else if (e.name === "route.ts") {
      out.push(p.replace(/\\/g, "/").replace(/^.*\/app\/api\//, "").replace(/\/route\.ts$/, ""));
    }
  }
  return out.sort();
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  routes: Record<string, string>;
};
const live = liveRoutes(API_DIR);

describe("API route authentication manifest", () => {
  it("classifies EVERY live route (a new unclassified route fails CI)", () => {
    const unclassified = live.filter((r) => !manifest.routes[r]);
    expect(unclassified, `Unclassified route(s) — add them to security/route-manifest.json`).toEqual([]);
  });

  it("has no stale entries (a deleted route must be removed from the manifest)", () => {
    const liveSet = new Set(live);
    const stale = Object.keys(manifest.routes).filter((r) => !liveSet.has(r));
    expect(stale, `Stale manifest entr(y/ies) — route file(s) no longer exist`).toEqual([]);
  });

  it("uses only valid classifications and has ZERO unknowns", () => {
    for (const [route, cls] of Object.entries(manifest.routes)) {
      expect(VALID_CLASSES, `${route} has invalid class ${cls}`).toContain(cls);
      expect(cls).not.toBe("UNKNOWN");
    }
  });

  it("route count matches disk exactly", () => {
    expect(Object.keys(manifest.routes).length).toBe(live.length);
  });
});
