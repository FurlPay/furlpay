import { describe, expect, it } from "vitest";
import { navTabFor, onboardingPath, resolveOnboardingSlug, resolveSettlementPath, SECTION_SUBPAGES, SETTLEMENT_REDIRECTS, SETTLEMENT_SECTIONS, STEP_ALIASES, STEP_SLUG } from "../routes";
import { SECTIONS } from "@/components/settlement/SettlementWorkspace";
import { STEPS } from "../onboarding";

describe("onboarding step URLs", () => {
  it("every step has exactly one canonical slug, and slugs are unique", () => {
    expect(Object.keys(STEP_SLUG).sort()).toEqual([...STEPS].sort());
    expect(new Set(Object.values(STEP_SLUG)).size).toBe(STEPS.length);
  });

  it("canonical URLs match the published route list", () => {
    expect(STEPS.map(onboardingPath)).toEqual([
      "/settlement/onboarding/business-information",
      "/settlement/onboarding/identity",
      "/settlement/onboarding/business-details",
      "/settlement/onboarding/compliance",
      "/settlement/onboarding/treasury",
      "/settlement/onboarding/settlement",
      "/settlement/onboarding/review",
    ]);
  });

  it("canonical slugs render without a redirect", () => {
    for (const s of STEPS) expect(resolveOnboardingSlug(STEP_SLUG[s])).toEqual({ step: s, redirect: null });
  });

  it("aliases redirect to the canonical URL (one address per step)", () => {
    expect(resolveOnboardingSlug("business")).toEqual({ step: "business", redirect: "/settlement/onboarding/business-information" });
    expect(resolveOnboardingSlug("details")).toEqual({ step: "details", redirect: "/settlement/onboarding/business-details" });
    expect(resolveOnboardingSlug("review-activate")?.redirect).toBe("/settlement/onboarding/review");
  });

  it("unknown or hostile segments resolve to nothing (404)", () => {
    for (const s of ["", "constructor", "__proto__", "prototype", "toString", "valueOf", "hasOwnProperty", "../review", "REVIEW", "businessx"]) expect(resolveOnboardingSlug(s)).toBeNull();
  });
});

describe("settlement workspace URLs", () => {
  it("real pages resolve; unknown sub-pages and deep paths 404 instead of falling back", () => {
    expect(resolveSettlementPath([])).toEqual({ kind: "page" });
    expect(resolveSettlementPath(["payments"])).toEqual({ kind: "page" });
    expect(resolveSettlementPath(["payments", "invoices"])).toEqual({ kind: "page" });
    expect(resolveSettlementPath(["treasury", "rules"])).toEqual({ kind: "page" });
    expect(resolveSettlementPath(["compliance"])).toEqual({ kind: "page" });
    for (const bad of [["payments", "bogus"], ["compliance", "x"], ["payments", "invoices", "x"], ["nope"], ["constructor"], ["prototype"], ["toString"], ["valueOf"], ["hasOwnProperty"], ["__proto__"], ["payments", "constructor"], ["payments", ""], ["onboarding"]])
      expect(resolveSettlementPath(bad)).toEqual({ kind: "not_found" });
  });
  it("short names redirect to the page they mean", () => {
    expect(resolveSettlementPath(["rules"])).toEqual({ kind: "redirect", to: "/settlement/treasury/rules" });
    for (const n of ["constructor", "toString", "hasOwnProperty"]) expect(navTabFor(`/settlement/${n}`), n).toBeNull();
    expect(resolveSettlementPath(["activity"])).toEqual({ kind: "redirect", to: "/settlement/payments/transactions" });
  });
  it("matches the sub-pages the workspace actually renders", () => {
    for (const s of SECTIONS) expect([...SECTION_SUBPAGES[s.id as keyof typeof SECTION_SUBPAGES]]).toEqual(s.subs.map((x) => x.slug));
    expect(Object.keys(SECTION_SUBPAGES).sort()).toEqual([...SETTLEMENT_SECTIONS].sort());
  });
});

describe("next.config redirects mirror the route table", () => {
  it("every alias has a real 308 in next.config.js, and nothing else is redirected there", () => {
    const configured: { source: string; destination: string; permanent: boolean }[] = require("../../../../next.config.js").settlementRedirects;
    const expected = [
      ...Object.keys(STEP_ALIASES).map((a) => ({ source: `/settlement/onboarding/${a}`, destination: resolveOnboardingSlug(a)!.redirect })),
      ...Object.entries(SETTLEMENT_REDIRECTS).map(([a, to]) => ({ source: `/settlement/${a}`, destination: to })),
    ];
    expect(configured.map(({ source, destination }) => ({ source, destination })).sort((x, y) => x.source.localeCompare(y.source))).toEqual(expected.sort((x, y) => x.source.localeCompare(y.source)));
    expect(configured.every((r) => r.permanent)).toBe(true);
  });
});
