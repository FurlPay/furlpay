import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DOC_ORDER } from "@/lib/docs/nav";
import { SEARCH_INDEX } from "@/lib/docs/search";
import { CAPABILITIES } from "@/lib/productionStatus";

/*
 * The docs portal is assembled from four hand-edited places: page files, the
 * sidebar, the search index and llms.txt. These tests keep them pointing at
 * each other, and keep the docs from naming API routes, scheduled jobs or
 * migrations that do not exist in this tree. They do not judge whether a
 * sentence is true; they catch the mechanical ways a page goes stale.
 */

const WEB = process.cwd();
const DOCS = join(WEB, "src", "app", "docs");
const API = join(WEB, "src", "app", "api");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const pageFiles = pages(DOCS);
const hrefOf = (file: string) => {
  const rel = file.slice(DOCS.length).replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
  return "/docs" + rel;
};
const navHrefs = new Set(DOC_ORDER.map((d) => d.href));

/** Does an /api path written in prose resolve to a route file? `{x}` and `[x]` are dynamic segments. */
function apiRouteExists(path: string): boolean {
  const segments = path.replace(/^\/api\//, "").split("/").filter(Boolean);
  let dirs = [API];
  for (const seg of segments) {
    const dynamic = /^[{[].*[}\]]$/.test(seg);
    const next: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (!statSync(full).isDirectory()) continue;
        if (name === seg || (dynamic && name.startsWith("[")) || (name.startsWith("[") && !name.startsWith("[...") && dynamic)) next.push(full);
        // A literal segment may also be served by a dynamic directory.
        else if (!dynamic && name.startsWith("[")) next.push(full);
      }
    }
    dirs = next;
    if (!dirs.length) return false;
  }
  return dirs.some((d) => existsSync(join(d, "route.ts")));
}

describe("docs navigation", () => {
  it("has a page file for every sidebar entry", () => {
    const missing = [...navHrefs].filter((h) => !pageFiles.some((f) => hrefOf(f) === h));
    expect(missing, "sidebar entries with no page").toEqual([]);
  });

  it("lists every docs page in the sidebar", () => {
    const orphaned = pageFiles.map(hrefOf).filter((h) => !navHrefs.has(h));
    expect(orphaned, "pages missing from DOCS_NAV (docMeta would throw at build)").toEqual([]);
  });

  it("gives every entry a unique href and a description", () => {
    expect(new Set(DOC_ORDER.map((d) => d.href)).size).toBe(DOC_ORDER.length);
    for (const d of DOC_ORDER) expect(d.desc.length, `${d.href} has no description`).toBeGreaterThan(20);
  });
});

describe("docs search index", () => {
  it("only points at pages that exist", () => {
    const dead = SEARCH_INDEX.map((s) => s.href).filter((h) => h.startsWith("/docs") && !navHrefs.has(h.split("#")[0]));
    expect(dead, "search results that 404").toEqual([]);
  });
});

describe("docs content", () => {
  it("links only to docs pages that exist", () => {
    const dead: string[] = [];
    for (const file of pageFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/href="(\/docs[^"#]*)(#[^"]*)?"/g)) {
        if (!navHrefs.has(m[1].replace(/\/$/, "") || "/docs")) dead.push(`${hrefOf(file)} -> ${m[1]}`);
      }
    }
    expect(dead, "broken internal docs links").toEqual([]);
  });

  it("names only API routes that exist in endpoint tables", () => {
    // Endpoint tables are the docs' API reference: `path: "/api/..."`. A path
    // with a wildcard, a list or a query string is a summary row, not one route.
    const missing: string[] = [];
    for (const file of pageFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/path: "(\/api\/[^"]+)"/g)) {
        const path = m[1].split("?")[0];
        if (/[*,\s]/.test(path)) continue;
        if (!apiRouteExists(path)) missing.push(`${hrefOf(file)}: ${path}`);
      }
    }
    expect(missing, "documented API routes with no route.ts").toEqual([]);
  });

  it("names only migrations that exist", () => {
    const dir = join(WEB, "..", "..", "supabase", "migrations");
    const names = new Set(readdirSync(dir).map((f) => f.replace(/\.sql$/, "")));
    const missing: string[] = [];
    for (const file of pageFiles) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<Code>(\d{4}_[a-z0-9_]+)<\/Code>/g)) {
        if (!names.has(m[1])) missing.push(`${hrefOf(file)}: ${m[1]}`);
      }
    }
    expect(missing, "documented migrations that are not in supabase/migrations").toEqual([]);
  });
});

describe("scheduled jobs", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(join(WEB, "vercel.json"), "utf8")).crons;

  it("schedules only jobs that have a route", () => {
    const missing = crons.map((c) => c.path).filter((p) => !apiRouteExists(p));
    expect(missing, "vercel.json crons with no route.ts").toEqual([]);
  });

  it("documents every scheduled job on the configuration page", () => {
    const page = readFileSync(join(DOCS, "architecture", "configuration", "page.tsx"), "utf8");
    const undocumented = crons.map((c) => c.path).filter((p) => !page.includes(`"${p}"`));
    expect(undocumented, "scheduled jobs missing from the configuration page").toEqual([]);
  });

  it("does not describe a scheduled job as unscheduled, or the reverse", () => {
    const page = readFileSync(join(DOCS, "architecture", "configuration", "page.tsx"), "utf8");
    const scheduled = new Set(crons.map((c) => c.path));
    const wrong: string[] = [];
    for (const m of page.matchAll(/name: "(\/api\/cron\/[^"]+)", type: "([^"]+)"/g)) {
      const saysScheduled = !m[2].includes("not scheduled");
      if (saysScheduled !== scheduled.has(m[1])) wrong.push(`${m[1]}: "${m[2]}"`);
    }
    expect(wrong, "cron status on the configuration page disagrees with vercel.json").toEqual([]);
  });
});

describe("llms.txt", () => {
  it("matches the docs navigation", () => {
    // Runs the real generator in --check mode so the test and the script cannot diverge.
    const out = execFileSync(process.execPath, [join(WEB, "scripts", "gen-llms.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("matches the docs navigation");
  });

  it("does not list a non-live capability under 'Available in production'", () => {
    const text = readFileSync(join(WEB, "public", "llms.txt"), "utf8").replace(/\r\n/g, "\n");
    const start = text.indexOf("## Available in production");
    expect(start, "llms.txt lost its availability section").toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf("\n## ", start + 5)).toLowerCase();
    // Phrases that would each assert a capability the registry records as not live.
    const forbidden: Record<string, string> = {
      cards: "card issuing",
      banking: "bank account",
      trading: "stock and etf orders",
      "merchant-payments": "hosted checkout",
      payroll: "payroll",
      "telegram-mini-app": "telegram",
      gasless: "gasless",
      "x402-settlement": "x402",
    };
    for (const [id, phrase] of Object.entries(forbidden)) {
      const record = CAPABILITIES.find((c) => c.id === id);
      expect(record, `registry lost ${id}`).toBeTruthy();
      if (record!.status !== "live") expect(section.includes(phrase), `llms.txt lists "${phrase}" as available but ${id} is ${record!.status}`).toBe(false);
    }
  });
});
