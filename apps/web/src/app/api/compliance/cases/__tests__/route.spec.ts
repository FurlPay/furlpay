import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Through the real handlers, dev case store and dev onboarding store. Doubles:
// session/role lookup, rate limiter, audit sink, account lookup, live roles.
type Acc = { user: { id: string; name: string; email: string; kycStatus: string; roles: string[] }; transactions: unknown[] };
const m = vi.hoisted(() => ({ as: "officer-1" as string | null, accounts: {} as Record<string, Acc>, events: [] as { event: string; actor: string; fields: Record<string, unknown> }[] }));
vi.mock("@/lib/authz", () => ({
  requireRole: async (_r: unknown, role: string) => {
    const a = m.as ? m.accounts[m.as] : undefined;
    if (!a) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    return a.user.roles.includes(role) ? { ok: true, account: a } : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  },
}));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<object>()), getAccountDurable: async (id: string) => m.accounts[id] ?? null }));
vi.mock("@/lib/compliance/roleGrants", async (orig) => ({ ...(await orig<object>()), effectiveRoles: async (a: Acc) => a.user.roles }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: (event: string, actor: string, fields: Record<string, unknown>) => void m.events.push({ event, actor, fields }) }));

import { GET as LIST, POST as CREATE } from "../route";
import { GET as DETAIL, POST as ACT } from "../[id]/route";
import { GET as RULES, POST as EVALUATE } from "../../monitoring/route";
import { GET as REPORT } from "../../reports/route";
import { resetCaseStore } from "@/lib/compliance/caseStore";
import { resetDevelopmentStore, updateState } from "@/lib/settlement/onboardingStore";

const U = "https://furlpay.com/api/compliance";
const get = (path: string) => new NextRequest(`${U}${path}`);
const post = (path: string, body: unknown) => new NextRequest(`${U}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const acct = (id: string, roles: string[], transactions: unknown[] = []): Acc => ({ user: { id, name: id, email: `${id}@example.test`, kycStatus: "verified", roles }, transactions });
const T = (h: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + h * 3_600_000).toISOString();

beforeEach(() => {
  resetCaseStore();
  resetDevelopmentStore();
  m.as = "officer-1";
  m.events = [];
  m.accounts = {
    "officer-1": acct("officer-1", ["user", "compliance_officer"]),
    "officer-2": acct("officer-2", ["user", "compliance_officer"]),
    "applicant-1": acct("applicant-1", ["user"], [
      { id: "t1", category: "transfer", direction: "out", title: "x", subtitle: "", amountUsd: 9_500, status: "settled", timestamp: T(0) },
      { id: "t2", category: "transfer", direction: "out", title: "x", subtitle: "", amountUsd: 9_000, status: "settled", timestamp: T(5) },
      { id: "t3", category: "transfer", direction: "out", title: "x", subtitle: "", amountUsd: 8_900, status: "settled", timestamp: T(9) },
      { id: "t4", category: "transfer", direction: "in", title: "x", subtitle: "", amountUsd: 15_000, status: "settled", timestamp: T(40) },
    ]),
  };
});

describe("authorization", () => {
  it("signed-out callers and applicants are refused on every endpoint", async () => {
    for (const who of [null, "applicant-1"]) {
      m.as = who;
      const want = who ? 403 : 401;
      expect((await LIST(get("/cases"))).status).toBe(want);
      expect((await CREATE(post("/cases", {}))).status).toBe(want);
      expect((await DETAIL(get("/cases/x"), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(want);
      expect((await ACT(post("/cases/x", { action: "note", reason: "hello there" }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(want);
      expect((await RULES(get("/monitoring"))).status).toBe(want);
      expect((await EVALUATE(post("/monitoring", { subjectId: "applicant-1" }))).status).toBe(want);
      expect((await REPORT(get("/reports?type=cases"))).status).toBe(want);
    }
  });

  it("malicious or unknown filters are rejected, not passed to storage", async () => {
    for (const q of ["?status=OPEN,CLOSED", "?type=kyb_review;drop", "?severity=extreme", "?assignee=officer-2", "?foo=1", "?status=open&status=all)"]) {
      expect((await LIST(get(`/cases${q}`))).status, q).toBe(400);
    }
    expect((await REPORT(get("/reports?type=../../etc"))).status).toBe(400);
    expect((await REPORT(get("/reports?type=cases&from=2026-13-99x"))).status).toBe(400);
  });

  it("unknown or malformed case ids are 404", async () => {
    expect((await DETAIL(get("/cases/x"), ctx("constructor"))).status).toBe(404);
    expect((await DETAIL(get("/cases/x"), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
  });
});

describe("case management", () => {
  it("derives cases from onboarding, once, and lists them by SLA", async () => {
    await updateState("applicant-1", (s) => ({ ...s, business: { legalName: "Northwind Ltd" } as never, review: { status: "pending", submittedAt: T(0), history: [] } }));
    const first = await json(await LIST(get("/cases")));
    expect(first.body.sync).toEqual({ opened: 1, resolved: 0 });
    expect(first.body.cases).toHaveLength(1);
    expect(first.body.cases[0]).toMatchObject({ type: "kyb_review", status: "OPEN", sla: expect.any(String) });
    const again = await json(await LIST(get("/cases")));
    expect(again.body.sync).toEqual({ opened: 0, resolved: 0 });
    expect(again.body.cases).toHaveLength(1);
  });

  it("full officer workflow is persisted and audited; assignment only to officers", async () => {
    const created = await json(await CREATE(post("/cases", { type: "fraud", subjectType: "individual", subjectId: "applicant-1", title: "Account takeover report", severity: "high", reason: "Customer reported unauthorised login" })));
    expect(created.status).toBe(201);
    const id = created.body.case.id;
    expect((await json(await ACT(post(`/cases/${id}`, { action: "assign", assignee: "applicant-1" }), ctx(id)))).status).toBe(422); // subject / non-officer
    expect((await json(await ACT(post(`/cases/${id}`, { action: "assign", assignee: "nobody-here" }), ctx(id)))).status).toBe(422);
    expect((await json(await ACT(post(`/cases/${id}`, { action: "assign", assignee: "officer-2" }), ctx(id)))).body.case.status).toBe("ASSIGNED");
    m.as = "officer-2";
    await ACT(post(`/cases/${id}`, { action: "start" }), ctx(id));
    expect((await json(await ACT(post(`/cases/${id}`, { action: "resolve", resolution: "no_action" }), ctx(id)))).status).toBe(400); // reason required
    const resolved = await json(await ACT(post(`/cases/${id}`, { action: "resolve", resolution: "account_restricted", reason: "Session revoked, password reset enforced" }), ctx(id)));
    expect(resolved.body.case).toMatchObject({ status: "RESOLVED", resolution: "account_restricted", decisionReason: "Session revoked, password reset enforced" });
    expect((await json(await ACT(post(`/cases/${id}`, { action: "start" }), ctx(id)))).status).toBe(409); // invalid transition
    const detail = await json(await DETAIL(get(`/cases/${id}`), ctx(id)));
    expect(detail.body.case.events.map((e: { action: string }) => e.action)).toEqual(["opened", "assign", "start", "resolve"]);
    expect(detail.body.allowed).toEqual(["close", "reopen", "note"]);
    expect(m.events.filter((e) => e.event === "compliance.case_action").map((e) => e.fields.action)).toEqual(["assign", "start", "resolve"]);
    expect(m.events.find((e) => e.event === "compliance.case_opened")?.actor).toBe("officer-1");
  });

  it("a case about an onboarding decision cannot be resolved until that decision is made", async () => {
    await updateState("applicant-1", (s) => ({ ...s, business: { legalName: "Northwind Ltd" } as never, review: { status: "pending", submittedAt: T(0), history: [] } }));
    const [c] = (await json(await LIST(get("/cases")))).body.cases;
    for (const a of [{ action: "triage" }, { action: "escalate", reason: "Senior review needed" }, { action: "start" }]) await ACT(post("/x", a), ctx(c.id));
    const r = await json(await ACT(post("/x", { action: "resolve", resolution: "no_action", reason: "Looks fine to me" }), ctx(c.id)));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Decide the onboarding review first/);
    await updateState("applicant-1", (s) => ({ ...s, review: { ...s.review!, status: "approved" } }));
    expect((await ACT(post("/x", { action: "resolve", resolution: "no_action", reason: "Review approved" }), ctx(c.id))).status).toBe(200);
  });

  it("an officer cannot open or act on a case about themselves", async () => {
    expect((await CREATE(post("/cases", { type: "fraud", subjectType: "individual", subjectId: "officer-1", title: "Self case", severity: "low", reason: "should not work" }))).status).toBe(403);
    m.as = "officer-2";
    const c = await json(await CREATE(post("/cases", { type: "fraud", subjectType: "individual", subjectId: "officer-1", title: "About officer one", severity: "low", reason: "peer review" })));
    m.as = "officer-1";
    const r = await json(await ACT(post(`/cases/${c.body.case.id}`, { action: "triage" }), ctx(c.body.case.id)));
    expect(r.status).toBe(403);
    expect((await json(await DETAIL(get("/x"), ctx(c.body.case.id)))).body.allowed).toEqual([]);
  });
});

describe("transaction monitoring", () => {
  it("dry run back-tests without opening cases; a real run opens each alert once", async () => {
    const dry = await json(await EVALUATE(post("/monitoring", { subjectId: "applicant-1", dryRun: true })));
    expect(dry.body.alerts.map((a: { ruleId: string }) => a.ruleId).sort()).toEqual(["high_value", "structuring"]);
    expect(dry.body.opened).toBe(0);
    expect((await json(await LIST(get("/cases?type=monitoring_alert")))).body.cases).toHaveLength(0);
    const run = await json(await EVALUATE(post("/monitoring", { subjectId: "applicant-1" })));
    expect(run.body.opened).toBe(2);
    const replay = await json(await EVALUATE(post("/monitoring", { subjectId: "applicant-1" })));
    expect(replay.body.opened).toBe(0); // duplicate alerts are not reopened
    const cases = (await json(await LIST(get("/cases?type=monitoring_alert")))).body.cases;
    expect(cases).toHaveLength(2);
    const s = cases.find((c: { refs: { ruleId: string } }) => c.refs.ruleId === "structuring");
    const detail = await json(await DETAIL(get("/x"), ctx(s.id)));
    expect(detail.body.linked.transactions.map((t: { id: string }) => t.id)).toEqual(["t1", "t2", "t3"]);
  });
  it("cannot target yourself or an unknown account; window must be ISO", async () => {
    expect((await EVALUATE(post("/monitoring", { subjectId: "officer-1" }))).status).toBe(403);
    expect((await EVALUATE(post("/monitoring", { subjectId: "ghost-account" }))).status).toBe(404);
    expect((await EVALUATE(post("/monitoring", { subjectId: "applicant-1", from: "yesterday" }))).status).toBe(400);
  });
});

describe("reports", () => {
  it("exports CSV from stored records, audited, without PII columns", async () => {
    await EVALUATE(post("/monitoring", { subjectId: "applicant-1" }));
    const r = await REPORT(get("/reports?type=monitoring_alerts"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    const csv = await r.text();
    expect(csv).toContain("structuring");
    expect(csv).not.toContain("@example.test");
    expect(r.headers.get("x-report-truncated")).toBe("false");
    expect(m.events.at(-1)).toMatchObject({ event: "compliance.report_exported", actor: "officer-1", fields: { type: "monitoring_alerts", rows: 2, truncated: false } });
  });
});
