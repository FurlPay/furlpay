import { describe, expect, it } from "vitest";
import { appendHistory, decisionRecord, dispositionOf, MAX_HISTORY, nextRescreenAt, rescreenDue, runRecord } from "../screeningHistory";
import { auditTrailReport, casesReport, investigatorReport, kybReport, screeningReport } from "../reports";
import { applyAction, newCase } from "../cases";
import { emptyState, type OnboardingState } from "@/lib/settlement/onboarding";

const T0 = "2026-10-08T00:00:00.000Z";

describe("screening history", () => {
  it("maps every screening status, and a failed run is UNAVAILABLE — never CLEAR", () => {
    expect(dispositionOf("clear")).toBe("CLEAR");
    expect(dispositionOf("potential_match")).toBe("POTENTIAL_MATCH");
    expect(dispositionOf("cleared_by_review")).toBe("FALSE_POSITIVE");
    expect(dispositionOf("confirmed_match")).toBe("CONFIRMED_MATCH");
    expect(dispositionOf("failed")).toBe("UNAVAILABLE");
  });
  it("is append-only and bounded", () => {
    let h = appendHistory(undefined, runRecord({ screenedAt: T0, list: "OFAC SDN", names: 2, matches: [], status: "clear", requestKey: "k" }, "initial", "u1"));
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = appendHistory(h, decisionRecord("UNDER_REVIEW", "o1", `note ${i}`));
    expect(h).toHaveLength(MAX_HISTORY);
    expect(h.at(-1)?.reason).toBe(`note ${MAX_HISTORY + 4}`);
  });
  it("re-screening schedule follows country risk; never screened → no date", () => {
    expect(nextRescreenAt(undefined, "low")).toBeNull();
    expect(nextRescreenAt(T0, "high")).toBe("2027-01-06T00:00:00.000Z");
    expect(nextRescreenAt(T0, "low")).toBe("2027-10-08T00:00:00.000Z");
    expect(rescreenDue(T0, "high", Date.parse("2027-01-07T00:00:00Z"))).toBe(true);
    expect(rescreenDue(T0, "low", Date.parse("2027-01-07T00:00:00Z"))).toBe(false);
  });
});

describe("report exports", () => {
  const state: OnboardingState = {
    ...emptyState(),
    business: { type: "company", legalName: "=HYPERLINK(\"https://evil\")", country: "GB", registrationNumber: "123", industry: "Technology & Software", address: { line1: "1 Example Street", city: "London", region: "Greater London", postalCode: "EC1A 1BB" } } as OnboardingState["business"],
    identity: { verification: "kyb", representative: { fullName: "Avery Quinn", dateOfBirth: "1988-10-15", email: "avery@example.test", phoneCountry: "GB", phone: "20 7946 0018", idType: "PASSPORT", idNumberLast4: "4567" } } as OnboardingState["identity"],
    screeningHistory: [runRecord({ screenedAt: T0, list: "OFAC SDN", names: 3, matches: [{ name: "NORTH WAY", score: 0.9, source: "OFAC_SDN" }], status: "potential_match", requestKey: "k" }, "initial", "owner-1")],
    review: { status: "approved", history: [{ at: T0, by: "officer-1", action: "approve_case", reason: "In order" }] },
  };
  it("never exports DOB, email, phone or ID numbers", () => {
    const csv = screeningReport([{ ownerId: "owner-1", state }], {}) + kybReport([{ ownerId: "owner-1", state }], {});
    for (const pii of ["1988-10-15", "avery@example.test", "7946", "4567", "Avery Quinn"]) expect(csv).not.toContain(pii);
    expect(csv).toContain("NORTH WAY 90%");
    expect(csv).toContain("approve_case");
  });
  it("neutralises spreadsheet formulas", () => {
    expect(screeningReport([{ ownerId: "owner-1", state }], {})).toContain("\"'=HYPERLINK(\"\"https://evil\"\")\"");
  });
  it("filters by date range (inclusive from, exclusive to)", () => {
    expect(screeningReport([{ ownerId: "owner-1", state }], { from: "2026-10-09T00:00:00.000Z" }).split("\r\n").filter(Boolean)).toHaveLength(1); // header only
    expect(screeningReport([{ ownerId: "owner-1", state }], { from: T0, to: "2026-10-09T00:00:00.000Z" }).split("\r\n").filter(Boolean)).toHaveLength(2);
  });
  it("case, audit-trail and investigator reports come from the stored timeline", () => {
    let c = newCase({ sourceKey: "k", type: "sanctions_match", subjectType: "business", subjectId: "owner-1", title: "Sanctions", severity: "high", actor: "system", now: T0 });
    c = applyAction(applyAction(c, { action: "assign", assignee: "officer-1" }, "officer-1", T0), { action: "start" }, "officer-1", T0);
    c = applyAction(c, { action: "resolve", resolution: "false_positive", reason: "Different entity" }, "officer-1", T0);
    expect(casesReport([c], {})).toContain("false_positive");
    expect(auditTrailReport([c], {}).split("\r\n").filter(Boolean)).toHaveLength(5); // header + opened, assign, start, resolve
    expect(investigatorReport([c], {})).toContain('"officer-1","3","1","0","0"');
  });
});
