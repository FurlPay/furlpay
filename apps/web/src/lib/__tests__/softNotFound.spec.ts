import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Soft 404s on dynamic page routes.
//
// A Next dynamic segment renders unknown params ON DEMAND by default. When the
// page then calls notFound(), the not-found page comes back with HTTP 200 —
// measured on /careers/nope before this was fixed. That is a soft 404: Google
// indexes the URL and treats the error page as content, so every typo, every
// stale link and every scraped guess becomes an indexable thin page.
//
// The fix is `export const dynamicParams = false`, which makes anything outside
// generateStaticParams a real 404 at routing time. It is only correct when the
// param set is COMPLETE — enumerated from data in the repo, not fetched.
//
// So the rule this pins is conditional, not blanket:
//
//   a dynamic page route that declares generateStaticParams must also declare
//   dynamicParams.
//
// Having generateStaticParams is the author saying "I know the full set". A
// route with no generateStaticParams is on-demand by design (a user's ticket, a
// booking id, a ticker from a universe of thousands) and is not covered — those
// must handle their own misses, which is a different problem from this one.
//
// Declaring `dynamicParams = true` explicitly also satisfies this: that is a
// deliberate statement that the list is a warm-up set rather than the whole
// world. What fails is saying nothing at all and inheriting a soft 404.
// ---------------------------------------------------------------------------

const APP = join(__dirname, "..", "..", "app");

/** Every page.tsx under a [param] segment. */
function dynamicPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) dynamicPages(full, out);
    else if (entry === "page.tsx" && /\[[^\]]+\]/.test(full)) out.push(full);
  }
  return out;
}

const pages = dynamicPages(APP).map((f) => ({
  path: f.slice(APP.length + 1).replace(/\\/g, "/"),
  src: readFileSync(f, "utf8"),
}));

describe("dynamic page routes", () => {
  it("finds the dynamic routes at all", () => {
    // Guards the guard: a wrong APP path makes every assertion below vacuous.
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it("declares dynamicParams wherever the full param set is enumerated", () => {
    const offenders = pages
      .filter((p) => /export\s+(?:async\s+)?function\s+generateStaticParams/.test(p.src))
      .filter((p) => !/export\s+const\s+dynamicParams\s*=/.test(p.src))
      .map((p) => p.path);

    expect(
      offenders,
      "These routes enumerate their params but inherit on-demand rendering, so an " +
        "unknown slug returns the not-found page with HTTP 200 (a soft 404). Add " +
        "`export const dynamicParams = false`, or `= true` with a comment saying why " +
        "the enumerated list is only a subset:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the routes that were fixed on 27 Sep 2026 fixed", () => {
    // Named explicitly so a future refactor that drops the line fails loudly
    // rather than quietly reintroducing an indexable error page.
    const fixed = [
      "blog/[slug]/page.tsx",
      "blog/author/[slug]/page.tsx",
      "blog/category/[category]/page.tsx",
      "careers/[slug]/page.tsx",
      "events/[slug]/page.tsx",
      "hotels/[city]/page.tsx",
      "integrations/[slug]/page.tsx",
      "investing/insights/[slug]/page.tsx",
      "investing/insights/category/[category]/page.tsx",
      "learn/[slug]/page.tsx",
      "travel/destinations/[slug]/page.tsx",
      "travel/guides/[slug]/page.tsx",
      "travel/itineraries/[slug]/page.tsx",
    ];
    for (const path of fixed) {
      const page = pages.find((p) => p.path === path);
      expect(page, `${path} not found — was it moved or deleted?`).toBeDefined();
      expect(page!.src, path).toMatch(/export\s+const\s+dynamicParams\s*=\s*false/);
    }
  });
});
