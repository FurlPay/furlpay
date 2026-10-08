import { describe, expect, it } from "vitest";
import {
  detailsSchema,
  emptyState,
  progress,
  readiness,
  resumeStep,
  settlementSchema,
  stepBlockers,
  stepStatuses,
  type OnboardingState,
} from "../onboarding";
import * as fx from "./fixtures";
import { REQUIRED_DOCS } from "./fixtures";
import { activity, decodeCursor, inTransit, matchesType, page, treasury } from "../overview";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rule = (n: number, percent: number, destination: "treasury" | "vendor" | "reserve" = "treasury") => ({ id: uuid(n), percent, destination, label: destination, assets: "all" as const });
const routing = [
  { network: "arbitrum" as const, enabled: true, primary: true },
  { network: "base" as const, enabled: true, primary: false },
];
const base = {
  routing,
  preferences: { autoConversion: true, networkOptimization: true, complianceChecks: true },
  notifications: { paymentReceived: true, payoutSent: true, approvalRequired: true, dailySummary: false },
  advanced: { manualReviewAboveUsd: 0, minimumSettlementUsd: 0 },
};

describe("settlement rules", () => {
  it("must total exactly 100%", () => {
    const bad = settlementSchema.safeParse({ ...base, model: "split", rules: [rule(1, 80), rule(2, 15, "vendor")] });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("must total 100%");
    expect(settlementSchema.safeParse({ ...base, model: "split", rules: [rule(1, 80), rule(2, 15, "vendor"), rule(3, 5, "reserve")] }).success).toBe(true);
  });
  it("needs exactly one enabled primary network", () => {
    const two = settlementSchema.safeParse({ ...base, model: "treasury", rules: [rule(1, 100)], routing: routing.map((r) => ({ ...r, primary: true })) });
    expect(two.success).toBe(false);
    const disabledPrimary = settlementSchema.safeParse({ ...base, model: "treasury", rules: [rule(1, 100)], routing: [{ network: "arbitrum", enabled: false, primary: true }, { network: "base", enabled: true, primary: false }] });
    expect(disabledPrimary.success).toBe(false);
  });
  it("only the split model has several destinations", () => {
    expect(settlementSchema.safeParse({ ...base, model: "treasury", rules: [rule(1, 50), rule(2, 50, "vendor")] }).success).toBe(false);
  });
});

describe("ownership", () => {
  const owner = (n: number, name: string, percent: number) => ({ id: uuid(n), name, type: "individual" as const, percent, role: "Director" });
  const details = (owners: ReturnType<typeof owner>[]) => ({ incorporationDate: "2020-01-12", description: "Software", employees: "11 - 50", revenue: "$1M - $10M", owners });
  it("cannot exceed 100% or repeat an owner", () => {
    expect(detailsSchema.safeParse(details([owner(1, "A", 70), owner(2, "B", 40)])).success).toBe(false);
    expect(detailsSchema.safeParse(details([owner(1, "A", 50), owner(2, "a", 10)])).success).toBe(false);
    expect(detailsSchema.safeParse(details([owner(1, "A", 70), owner(2, "B", 20)])).success).toBe(true);
  });
  it("does not require a 25% owner, but always one controlling individual (FinCEN control prong)", () => {
    const widelyHeld: OnboardingState = { ...emptyState(), details: details([owner(1, "A", 10)]) as OnboardingState["details"] };
    expect(stepBlockers(widelyHeld, "details")).toEqual([]);
    const corporateOnly = details([{ ...owner(1, "Holdco Ltd", 100), type: "corporate" as const }] as never);
    expect(detailsSchema.safeParse(corporateOnly).success).toBe(false);
    expect(stepBlockers({ ...emptyState(), details: corporateOnly as OnboardingState["details"] }, "details")).toHaveLength(1);
  });
  it("treats names differing only in case or spacing as the same owner", () => {
    expect(detailsSchema.safeParse(details([owner(1, "Avery  Quinn", 50), owner(2, " avery quinn", 10)])).success).toBe(false);
  });
});

describe("state machine", () => {
  it("starts at the first step and blocks later ones", () => {
    const st = stepStatuses(emptyState());
    expect(st.business).toBe("NOT_STARTED");
    expect(st.identity).toBe("BLOCKED");
    expect(resumeStep(emptyState())).toBe("business");
    expect(progress(emptyState())).toEqual({ done: 0, total: 7, pct: 0 });
  });
  it("progress counts completed steps and activation, never a constant", () => {
    const s = { ...emptyState(), completed: ["business", "identity", "details"] as OnboardingState["completed"] };
    expect(progress(s).pct).toBe(Math.round((3 / 7) * 100));
    expect(resumeStep(s)).toBe("compliance");
  });
  it("identity needs the required documents uploaded", () => {
    expect(stepBlockers(emptyState(), "identity").length).toBeGreaterThan(0);
  });
  it("compliance needs a clear screening", () => {
    expect(stepBlockers(emptyState(), "compliance")).toEqual(["Run sanctions screening."]);
    const hit = { ...emptyState(), screening: { screenedAt: "", list: "OFAC SDN", names: 3, matches: [{ name: "x", score: 0.9, source: "OFAC" }], status: "potential_match" as const } };
    expect(stepBlockers(hit, "compliance")[0]).toMatch(/potential match/);
  });
});

describe("readiness", () => {
  const verified = { kycStatus: "verified", documentStorage: true, identityProvider: true } as const;
  const docs = REQUIRED_DOCS.map((kind, i) => ({ id: uuid(i), kind, name: kind, size: 1, contentType: "application/pdf" as const, uploadedAt: "", review: "approved" as const }));
  const ready = (): OnboardingState => ({
    ...emptyState(),
    completed: ["business", "identity", "details", "compliance", "treasury", "settlement"],
    business: fx.business as OnboardingState["business"],
    identity: fx.identity as OnboardingState["identity"],
    details: fx.details as OnboardingState["details"],
    treasury: fx.treasury as OnboardingState["treasury"],
    settlement: settlementSchema.parse(fx.settlement([80, 15, 5])),
    documents: docs,
    screening: { screenedAt: "", list: "OFAC SDN", names: 3, matches: [], status: "clear" },
    review: { status: "approved", decidedAt: "2026-10-08T00:00:00Z", decidedBy: "officer-1", history: [] },
  });

  it("is ready only when every server fact holds", () => {
    const r = readiness(ready(), verified);
    expect(r).toMatchObject({ ready: true, blockers: [] });
    expect(r.checks.every((c) => c.status === "complete")).toBe(true);
  });
  it("an empty application lists every gate", () => {
    const r = readiness(emptyState(), { kycStatus: "unverified", documentStorage: true, identityProvider: false });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(expect.arrayContaining(["business_information_incomplete", "identity_verification_pending", "identity_provider_not_configured", "documents_missing", "screening_not_run", "compliance_review_pending", "treasury_not_configured", "settlement_not_configured"]));
  });
  it("blocks on identity pending; no provider shows as not configured", () => {
    expect(readiness(ready(), { ...verified, kycStatus: "pending" }).blockers).toEqual(["identity_verification_pending"]);
    const r = readiness(ready(), { ...verified, kycStatus: "unverified", identityProvider: false });
    expect(r.checks.find((c) => c.id === "identity")?.status).toBe("not_configured");
  });
  it("blocks on every non-clear screening state", () => {
    const at = (status: NonNullable<OnboardingState["screening"]>["status"]) => readiness({ ...ready(), screening: { ...ready().screening!, status } }, verified);
    expect(at("failed").blockers).toEqual(["screening_unavailable"]);
    expect(at("potential_match").blockers).toEqual(["screening_pending_review"]);
    expect(at("confirmed_match").blockers).toEqual(["screening_blocked"]);
    expect(at("confirmed_match").checks.find((c) => c.id === "screening")?.status).toBe("blocked");
    expect(at("cleared_by_review").ready).toBe(true);
    expect(readiness({ ...ready(), screening: undefined }, verified).blockers).toEqual(["screening_not_run"]);
  });
  it("blocks on documents not approved, rejected, or storage missing", () => {
    expect(readiness({ ...ready(), documents: docs.map((d) => ({ ...d, review: "received" as const })) }, verified).blockers).toEqual(["documents_pending_review"]);
    expect(readiness({ ...ready(), documents: [{ ...docs[0], review: "rejected" as const }, ...docs.slice(1)] }, verified).blockers).toEqual(["documents_rejected"]);
    expect(readiness({ ...ready(), documents: docs.slice(1) }, verified).blockers).toEqual(["documents_missing"]);
    expect(readiness(ready(), { ...verified, documentStorage: false }).blockers).toEqual(["document_storage_unavailable"]);
  });
  it("blocks until the compliance review is approved", () => {
    const at = (status: NonNullable<OnboardingState["review"]>["status"]) => readiness({ ...ready(), review: { status, history: [] } }, verified).blockers;
    expect(at("pending")).toEqual(["compliance_review_pending"]);
    expect(at("changes_requested")).toEqual(["compliance_review_changes_requested"]);
    expect(at("rejected")).toEqual(["compliance_review_rejected"]);
    expect(readiness({ ...ready(), review: undefined }, verified).blockers).toEqual(["compliance_review_pending"]);
  });
  it("re-validates stored settlement rules rather than trusting the completed flag", () => {
    const s = ready();
    s.settlement = { ...s.settlement!, rules: s.settlement!.rules.slice(0, 2) }; // 95%
    expect(readiness(s, verified).blockers).toEqual(["settlement_rules_invalid"]);
    expect(readiness({ ...ready(), completed: ready().completed.filter((x) => x !== "settlement") }, verified).blockers).toEqual(["settlement_not_configured"]);
  });
});

describe("overview metrics", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const tx = (id: string, h: number, usd: number, status = "settled", direction: "in" | "out" = "in", category = "transfer") => ({ id, category, direction, amountUsd: usd, status, timestamp: new Date(now - h * 3_600_000).toISOString() });
  const rows = [tx("a", 1, 100), tx("b", 2, 50, "pending", "out"), tx("c", 3, 25, "declined", "out"), tx("d", 30, 400), tx("e", 5, 10, "settled", "out", "swap")];

  it("treasury sums ledger USD values and groups rails", () => {
    const t = treasury([
      { asset: "USDC", network: "base", amount: 10, usd: 10, custody: "ledger" },
      { asset: "EUR", network: "bank", amount: 5, usd: 5.5, custody: "fiat" },
    ]);
    expect(t.total).toBe(15.5);
    expect(t.stablecoinUsd).toBe(10);
    expect(t.rails.map((r) => r.rail)).toEqual(["base", "bank"]);
  });
  it("in transit counts pending and escrow only", () => {
    expect(inTransit(rows)).toEqual({ usd: 50, count: 1 });
  });
  it("24h activity settles only settled rows and reports success rate", () => {
    const a = activity(rows, "24h", now);
    expect(a.settledUsd).toBe(110);
    expect(a.settledCount).toBe(2);
    expect(a.successRate).toBeCloseTo(2 / 3);
    expect(a.series).toHaveLength(24);
    expect(a.series.reduce((s, b) => s + b.usd, 0)).toBe(110);
  });
  it("success rate is null when nothing reached an outcome", () => {
    expect(activity([], "7d", now).successRate).toBeNull();
  });
  it("filters by type and pages with a stable cursor", () => {
    expect(rows.filter((r) => matchesType(r, "settlements")).map((r) => r.id)).toEqual(["e"]);
    expect(rows.filter((r) => matchesType(r, "refunds"))).toEqual([]);
    const first = page(rows, null, 2);
    expect(first.items.map((r) => r.id)).toEqual(["a", "b"]);
    const second = page(rows, decodeCursor(first.nextCursor), 2);
    expect(second.items.map((r) => r.id)).toEqual(["c", "e"]);
    expect(page(rows, decodeCursor(second.nextCursor), 2).nextCursor).toBeNull();
  });
});
