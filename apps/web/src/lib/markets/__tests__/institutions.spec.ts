import { describe, it, expect } from "vitest";
import {
  INSTITUTIONS,
  institutionBySlug,
  institutionByCik,
  normalizeCik,
  resolveInstitution,
} from "../institutions";

// ---------------------------------------------------------------------------
// The registry's invariants, and a drift check against EDGAR.
//
// The structural half runs offline on every suite. The live half only runs
// with CHECK_EDGAR=1, because it makes one network request per filer and the
// SEC publishes a 10 req/s ceiling for the whole site — a check that fires on
// every commit would be both slow and rude.
//
// The live half is the one that matters most in the long run. Every entry here
// was verified once, on 2026-09-02, and a manager restructuring its reporting
// is invisible from inside this repo: The Vanguard Group switched to filing
// 13F-NT and the only symptom was a portfolio silently three quarters stale.
// Run it before trusting the list again.
// ---------------------------------------------------------------------------

describe("the institution registry", () => {
  it("has a unique slug per filer", () => {
    const slugs = INSTITUTIONS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a unique CIK per filer", () => {
    // Two entries on one CIK would be the same filer under two names, and the
    // second would be unreachable by CIK lookup.
    const ciks = INSTITUTIONS.map((i) => i.cik);
    expect(new Set(ciks).size).toBe(ciks.length);
  });

  it("stores every CIK zero-padded to ten digits", () => {
    // EDGAR's submissions URLs are padded. An unpadded CIK 404s, and it 404s
    // at fetch time rather than here, which is where it would be noticed.
    for (const i of INSTITUTIONS) {
      expect(i.cik, i.slug).toMatch(/^\d{10}$/);
    }
  });

  it("uses URL-safe slugs", () => {
    for (const i of INSTITUTIONS) {
      expect(i.slug, i.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("names every filer twice, and never with an empty string", () => {
    // `name` is EDGAR's conformed name and is what makes the filing findable;
    // `label` is the readable form. A blank either way renders a nameless row.
    for (const i of INSTITUTIONS) {
      expect(i.name.trim().length, i.slug).toBeGreaterThan(0);
      expect(i.label.trim().length, i.slug).toBeGreaterThan(0);
    }
  });

  it("does not list the filers that were rejected during verification", () => {
    // Each of these resolves to a real EDGAR entity and each would look
    // entirely plausible in the list; every one of them either files no 13F-HR
    // or stopped years ago. Re-adding one is the exact mistake this catches.
    const rejected = [
      "0000102909", // VANGUARD GROUP INC — files 13F-NT since 2025-12-31
      "0001364742", // BlackRock Finance, Inc. — last 13F-HR 2024-06-30
      "0001006249", // BlackRock Fund Advisors — last 13F-HR 2016-12-31
      "0001079114", // GREENLIGHT CAPITAL INC — last 13F-HR 2023-12-31
      "0000029440", // DODGE & COX FUNDS — the registrant, not the adviser
      "0001113169", // PRICE T ROWE GROUP INC — no 13F-HR
    ];
    for (const cik of rejected) {
      expect(institutionByCik(cik), cik).toBeNull();
    }
  });
});

describe("looking a filer up", () => {
  it("finds one by slug", () => {
    expect(institutionBySlug("berkshire-hathaway")?.cik).toBe("0001067983");
  });

  it("accepts a CIK in every spelling a reader might type", () => {
    // Bare, padded and EDGAR's own prefixed form are the same filer. Treating
    // them as three is a 404 on a link that was written correctly.
    for (const spelling of ["19617", "0000019617", "CIK0000019617"]) {
      expect(institutionByCik(spelling)?.slug, spelling).toBe("jpmorgan-chase");
    }
  });

  it("resolves a URL segment that could be either", () => {
    expect(resolveInstitution("citadel-advisors")?.cik).toBe("0001423053");
    expect(resolveInstitution("1423053")?.slug).toBe("citadel-advisors");
  });

  it("returns null rather than a guess for an unknown segment", () => {
    // The route serves registry filers only. A near-miss must miss: resolving
    // it loosely would turn the route into an open proxy onto EDGAR.
    expect(resolveInstitution("berkshire")).toBeNull();
    expect(resolveInstitution("0000000001")).toBeNull();
    expect(resolveInstitution("")).toBeNull();
  });

  it("normalizes a CIK without inventing one", () => {
    expect(normalizeCik("19617")).toBe("0000019617");
    expect(normalizeCik("CIK0000019617")).toBe("0000019617");
    // No digits is not CIK zero — it is no CIK at all.
    expect(normalizeCik("")).toBe("");
    expect(normalizeCik("berkshire")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Live drift check. CHECK_EDGAR=1 npx vitest run institutions
// ---------------------------------------------------------------------------
const live = process.env.CHECK_EDGAR === "1" ? describe : describe.skip;

live("every registered filer still files a 13F-HR", () => {
  it(
    "resolves on EDGAR, with a holdings report that is not superseded",
    async () => {
      const { latestFiling } = await import("../providers/thirteenF");
      const problems: string[] = [];

      for (const i of INSTITUTIONS) {
        const ref = await latestFiling(i.cik);
        if (!ref) {
          problems.push(`${i.slug} (${i.cik}): no 13F-HR on EDGAR`);
        } else if (ref.supersededBy) {
          // The Vanguard failure mode: a holdings report still exists, but the
          // filer has since said someone else reports for them.
          problems.push(
            `${i.slug} (${i.cik}): holdings are ${ref.periodOfReport}, superseded by a ` +
              `${ref.supersededBy.form} for ${ref.supersededBy.periodOfReport}`
          );
        }
        // Stay under the SEC's 10 req/s ceiling.
        await new Promise((r) => setTimeout(r, 150));
      }

      expect(problems, problems.join("\n")).toEqual([]);
    },
    180_000
  );
});
