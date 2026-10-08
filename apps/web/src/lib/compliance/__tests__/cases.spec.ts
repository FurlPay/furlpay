import { beforeEach, describe, expect, it } from "vitest";
import { allowedActions, applyAction, CaseRefusal, newCase, resolveFromSource, slaDueAt, slaState, type ComplianceCase } from "../cases";
import { insertCaseIfAbsent, listCases, resetCaseStore, updateCase } from "../caseStore";
import { planFromOnboarding, syncOnboardingCases } from "../caseSync";
import { emptyState, type OnboardingState } from "@/lib/settlement/onboarding";

const T0 = "2026-10-08T00:00:00.000Z";
const base = (over: Partial<Parameters<typeof newCase>[0]> = {}) => newCase({ sourceKey: "k1", type: "kyb_review", subjectType: "business", subjectId: "owner-1", title: "KYB review — Northwind", severity: "medium", actor: "system", now: T0, ...over });

beforeEach(() => resetCaseStore());

describe("case state machine", () => {
  it("walks the full lifecycle with every transition recorded", () => {
    let c = base();
    c = applyAction(c, { action: "triage", severity: "high" }, "officer-1", T0);
    expect(c).toMatchObject({ status: "TRIAGED", severity: "high", slaDueAt: slaDueAt("high", T0) });
    c = applyAction(c, { action: "assign", assignee: "officer-2" }, "officer-1", T0);
    c = applyAction(c, { action: "start" }, "officer-2", T0);
    c = applyAction(c, { action: "escalate", reason: "Needs senior review" }, "officer-2", T0);
    expect(c).toMatchObject({ status: "ESCALATED", escalationLevel: 1 });
    c = applyAction(c, { action: "start" }, "officer-3", T0);
    c = applyAction(c, { action: "request_decision" }, "officer-3", T0);
    c = applyAction(c, { action: "resolve", resolution: "false_positive", reason: "Different entity, different country" }, "officer-3", T0);
    expect(c).toMatchObject({ status: "RESOLVED", resolution: "false_positive" });
    c = applyAction(c, { action: "close", reason: "Reviewed and closed" }, "officer-3", T0);
    expect(c.status).toBe("CLOSED");
    expect(c.events.map((e) => e.action)).toEqual(["opened", "triage", "assign", "start", "escalate", "start", "request_decision", "resolve", "close"]);
    expect(c.version).toBe(9);
  });

  it("refuses transitions that are not allowed from the current status", () => {
    const c = base();
    expect(() => applyAction(c, { action: "resolve", resolution: "no_action", reason: "skip ahead" }, "officer-1")).toThrow(CaseRefusal);
    expect(() => applyAction(c, { action: "close", reason: "skip ahead" }, "officer-1")).toThrow(/Cannot close/);
    expect(() => applyAction(c, { action: "start" }, "officer-1")).toThrow(CaseRefusal);
    expect(allowedActions(c)).toEqual(["triage", "assign", "note"]);
  });

  it("reopen is controlled: only from RESOLVED/CLOSED, with a reason, clearing the decision", () => {
    let c = applyAction(applyAction(applyAction(base(), { action: "assign", assignee: "o2" }, "o1"), { action: "start" }, "o2"), { action: "resolve", resolution: "no_action", reason: "Nothing found" }, "o2");
    c = applyAction(c, { action: "reopen", reason: "New information received" }, "o3");
    expect(c).toMatchObject({ status: "INVESTIGATING", resolution: null, decisionReason: null });
  });

  it("an officer can never act on a case about themselves", () => {
    expect(() => applyAction(base({ subjectId: "officer-1" }), { action: "note", reason: "looking" }, "officer-1")).toThrow(/about yourself/);
  });

  it("notes need text and do not change status", () => {
    const c = applyAction(base(), { action: "note", reason: "Called the applicant" }, "o1");
    expect(c.status).toBe("OPEN");
    expect(() => applyAction(base(), { action: "note", reason: "  " }, "o1")).toThrow(/needs text/);
  });
});

describe("SLA", () => {
  it("deadline by severity and state relative to now", () => {
    const c = base({ severity: "critical" });
    expect(c.slaDueAt).toBe("2026-10-09T00:00:00.000Z");
    expect(slaState(c, Date.parse("2026-10-08T01:00:00Z"))).toBe("due_soon");
    expect(slaState(c, Date.parse("2026-10-09T00:00:01Z"))).toBe("overdue");
    expect(slaState({ ...c, status: "RESOLVED" }, Date.parse("2026-12-01T00:00:00Z"))).toBe("met");
    expect(slaState(base({ severity: "low" }), Date.parse(T0))).toBe("on_track");
  });
});

describe("case store", () => {
  it("one case per source event, even under concurrent inserts", async () => {
    const results = await Promise.all([insertCaseIfAbsent(base()), insertCaseIfAbsent(base()), insertCaseIfAbsent(base())]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.case.id)).size).toBe(1);
    expect(await listCases({ status: ["OPEN"] })).toHaveLength(1);
  });

  it("concurrent officer actions serialise; an invalid second action is refused, not merged", async () => {
    const { case: c } = await insertCaseIfAbsent(base());
    const [a, b] = await Promise.allSettled([updateCase(c.id, (x) => applyAction(x, { action: "triage" }, "o1")), updateCase(c.id, (x) => applyAction(x, { action: "triage" }, "o2"))]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
  });
});

describe("case sync from onboarding", () => {
  const sc = (status: NonNullable<OnboardingState["screening"]>["status"]) => ({ screenedAt: T0, list: "OFAC SDN", names: 3, matches: [{ name: "NORTH WAY", score: 0.9, source: "OFAC_SDN" }], status, requestKey: "rk1" });
  it("plans a KYB review and a sanctions case from pending state", () => {
    const p = planFromOnboarding("owner-1", { ...emptyState(), review: { status: "pending", submittedAt: T0, history: [] }, screening: sc("potential_match") });
    expect(p.open.map((x) => [x.type, x.severity, x.sourceKey])).toEqual([
      ["kyb_review", "medium", `onboarding:owner-1:review:${T0}`],
      ["sanctions_match", "high", "screening:owner-1:rk1"],
    ]);
  });
  it("running the sync twice opens each case once, and source decisions resolve them", async () => {
    const pending = [{ ownerId: "owner-1", state: { ...emptyState(), review: { status: "pending" as const, submittedAt: T0, history: [] }, screening: sc("potential_match") } }];
    expect(await syncOnboardingCases(pending)).toEqual({ opened: 2, resolved: 0 });
    expect(await syncOnboardingCases(pending)).toEqual({ opened: 0, resolved: 0 });
    const decided = [{ ownerId: "owner-1", state: { ...emptyState(), review: { status: "approved" as const, submittedAt: T0, history: [] }, screening: { ...sc("cleared_by_review"), review: { by: "officer-1", at: T0, reason: "Different entity" } } } }];
    expect(await syncOnboardingCases(decided)).toEqual({ opened: 0, resolved: 2 });
    const all = await listCases();
    expect(all.map((c) => c.status)).toEqual(["RESOLVED", "RESOLVED"]);
    expect(all.find((c) => c.type === "sanctions_match")?.resolution).toBe("false_positive");
  });
  it("a case an officer reopened is not re-closed by the source", async () => {
    await syncOnboardingCases([{ ownerId: "owner-1", state: { ...emptyState(), review: { status: "pending", submittedAt: T0, history: [] } } }]);
    const [c] = await listCases();
    await updateCase(c.id, (x) => resolveFromSource(x, "source_resolved", "approved"));
    await updateCase(c.id, (x) => applyAction(x, { action: "reopen", reason: "Adverse media found after approval" }, "officer-1"));
    await syncOnboardingCases([{ ownerId: "owner-1", state: { ...emptyState(), review: { status: "approved", submittedAt: T0, history: [] } } }]);
    expect((await listCases())[0].status).toBe("INVESTIGATING");
  });
  it("a confirmed match always has a critical case on record", async () => {
    await syncOnboardingCases([{ ownerId: "owner-2", state: { ...emptyState(), screening: { ...sc("confirmed_match"), review: { by: "o1", at: T0, reason: "Confirmed" } } } }]);
    const [c] = await listCases();
    expect(c).toMatchObject({ type: "sanctions_match", severity: "critical", status: "RESOLVED", resolution: "confirmed" });
  });
});

export type _ = ComplianceCase;
