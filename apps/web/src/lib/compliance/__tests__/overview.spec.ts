import { describe, expect, it } from "vitest";
import { capabilities, complianceHealth, summarizeOnboarding } from "../overview";
import { emptyState, type OnboardingState } from "@/lib/settlement/onboarding";

const st = (patch: Partial<OnboardingState>): OnboardingState => ({ ...emptyState(), ...patch });
const doc = (review: "received" | "approved" | "rejected") => ({ id: crypto.randomUUID(), kind: "incorporation" as const, name: "x", size: 1, contentType: "application/pdf" as const, uploadedAt: "", review });
const screening = (status: NonNullable<OnboardingState["screening"]>["status"]) => ({ screenedAt: "", list: "OFAC SDN", names: 3, matches: [], status });

describe("capability registry", () => {
  it("with no credentials, nothing external claims to work", () => {
    const caps = capabilities({});
    const by = Object.fromEntries(caps.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ kyc: "not_configured", pep: "not_configured", sanctions: "live", wallet: "live", fraud: "not_available", monitoring: "not_available", travel_rule: "not_available", india: "not_available" });
    for (const c of caps) if (c.status === "not_configured" || c.status === "not_available") expect(c.requires, c.id).toBeTruthy();
  });
  it("credentials switch adapters to configured, and only the selected identity provider counts", () => {
    const by = (env: Record<string, string>) => Object.fromEntries(capabilities(env).map((c) => [c.id, c.status]));
    expect(by({ PERSONA_API_KEY: "x" }).kyc).toBe("configured");
    expect(by({ COMPLIANCE_IDENTITY_PROVIDER: "sumsub", PERSONA_API_KEY: "x" }).kyc).toBe("not_configured");
    expect(by({ COMPLIANCE_IDENTITY_PROVIDER: "sumsub", SUMSUB_APP_TOKEN: "a", SUMSUB_SECRET_KEY: "b" }).kyc).toBe("configured");
    expect(by({ COMPLYADVANTAGE_API_KEY: "x" })).toMatchObject({ sanctions: "configured", pep: "configured" });
    expect(by({ CIRCLE_COMPLIANCE_API_KEY: "x" }).wallet).toBe("configured");
  });
  it("never puts a secret value into the output", () => {
    const out = JSON.stringify(capabilities({ PERSONA_API_KEY: "persona_live_SECRET123", COMPLYADVANTAGE_API_KEY: "ca_SECRET456" }));
    expect(out).not.toMatch(/SECRET123|SECRET456/);
  });
});

describe("onboarding summary", () => {
  it("counts review, screening, documents and activation from stored state", () => {
    const s = summarizeOnboarding([
      st({}),
      st({ review: { status: "pending", history: [] }, screening: screening("potential_match"), documents: [doc("received"), doc("approved")] }),
      st({ review: { status: "approved", history: [] }, screening: screening("clear"), activation: { status: "ACTIVE" } }),
      st({ review: { status: "rejected", history: [] }, screening: screening("confirmed_match") }),
      st({ review: { status: "changes_requested", history: [] }, screening: screening("failed"), documents: [doc("received")] }),
      st({ screening: screening("cleared_by_review") }),
    ]);
    expect(s).toMatchObject({ cases: 6, submitted: 4, pendingReview: 1, changesRequested: 1, approved: 1, rejected: 1, active: 1, documentsAwaitingReview: 2, openAlerts: 2 });
    expect(s.screening).toEqual({ notRun: 1, clear: 1, potentialMatch: 1, clearedByReview: 1, confirmedMatch: 1, failed: 1 });
  });
  it("an empty system is all zeros, not invented activity", () => {
    expect(summarizeOnboarding([])).toMatchObject({ cases: 0, openAlerts: 0, active: 0 });
  });
});

describe("compliance health formula", () => {
  const all = capabilities({ PERSONA_API_KEY: "x", COMPLYADVANTAGE_API_KEY: "x" });
  const quiet = summarizeOnboarding([]);
  it("cannot be 'operational' without identity verification", () => {
    const h = complianceHealth(capabilities({}), quiet);
    expect(h.level).not.toBe("operational");
    expect(h.reasons[0]).toMatch(/Identity verification is not configured/);
  });
  it("is deterministic and explains every deduction", () => {
    // configured KYC + CA: still missing fraud, monitoring, travel rule, india → −30
    expect(complianceHealth(all, quiet)).toEqual({ level: "degraded", score: 70, reasons: [expect.stringMatching(/4 capabilities are not available/)] });
    const busy = summarizeOnboarding([
      st({ review: { status: "pending", history: [] }, screening: screening("potential_match") }),
      st({ screening: screening("failed") }),
    ]);
    const h = complianceHealth(all, busy);
    expect(h.score).toBe(70 - 15 - 5 - 2);
    expect(h.reasons).toHaveLength(4);
  });
  it("missing onboarding data is reported, not scored as healthy", () => {
    expect(complianceHealth(all, null).reasons).toContain("Onboarding records are unavailable.");
  });
  it("is clamped at zero", () => {
    const many = summarizeOnboarding(Array.from({ length: 20 }, () => st({ review: { status: "pending", history: [] }, screening: screening("potential_match") })));
    expect(complianceHealth(capabilities({}), { ...many, screening: { ...many.screening, failed: 3 } }).score).toBe(0);
  });
});
