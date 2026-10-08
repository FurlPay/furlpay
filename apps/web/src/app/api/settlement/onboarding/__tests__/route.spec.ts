import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// End-to-end through the real route handlers and the development store. Only
// the session/role lookup, the rate limiter, the audit sink and the sanctions
// provider are doubles. Accounts and roles below are test fixtures.
type Role = "user" | "compliance_officer" | "admin";
const m = vi.hoisted(() => ({
  as: "owner-1",
  accounts: {} as Record<string, { user: { id: string; name: string; kycStatus: string }; roles: Role[] }>,
  hits: [] as { name: string; matchScore: number; sources: string[] }[],
  fail: false,
  calls: 0,
  events: [] as { event: string; actor: string; fields: Record<string, unknown> }[],
}));
vi.mock("@/lib/authz", () => {
  const who = () => m.accounts[m.as];
  return {
    requireUser: async () => (who() ? { ok: true, account: who() } : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }),
    requireRole: async (_req: unknown, role: Role) => {
      const a = who();
      if (!a) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      return a.roles.includes(role) ? { ok: true, account: a } : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    },
  };
});
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<object>()), getAccountDurable: async (id: string) => m.accounts[id] ?? null }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: (event: string, actor: string, fields: Record<string, unknown>) => void m.events.push({ event, actor, fields }) }));
vi.mock("@/lib/compliance/providers/factory", () => ({
  getScreeningProvider: async () => ({
    name: "furlpay",
    screenSanctions: async () => {
      m.calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (m.fail) throw new Error("upstream 502");
      return { hits: m.hits };
    },
  }),
  getIdentityProvider: async () => {
    throw new Error("not configured");
  },
}));

import { GET, POST, PUT } from "../route";
import { POST as UPLOAD, DELETE as REMOVE } from "../documents/route";
import { GET as QUEUE, POST as DECIDE } from "../review/route";
import { GET as OPEN_DOC } from "../review/document/route";
import { resetDevelopmentStore } from "@/lib/settlement/onboardingStore";
import { business, details, identity, REQUIRED_DOCS, settlement, treasury } from "@/lib/settlement/__tests__/fixtures";

const URL_ = "https://furlpay.com/api/settlement/onboarding";
const json = (method: string, body?: unknown, url = URL_) => new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
const put = (step: string, data: unknown, complete = true) => PUT(json("PUT", { step, data, complete }));
const act = (body: unknown) => POST(json("POST", body));
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const view = async () => (await read(await GET(json("GET")))).body;
const decide = (body: Record<string, unknown>) => DECIDE(json("POST", body, `${URL_}/review`));
const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF"));
async function upload(kind: string, bytes = pdf, type = "application/pdf") {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", new File([bytes], `${kind}.pdf`, { type }));
  return read(await UPLOAD(new NextRequest(`${URL_}/documents`, { method: "POST", body: form })));
}
const as = (id: string) => (m.as = id);

/** Applicant fills every step up to compliance (screening not yet run). */
async function profile() {
  await put("business", business);
  for (const k of REQUIRED_DOCS) expect((await upload(k)).status).toBe(201);
  expect((await read(await put("identity", identity))).status).toBe(200);
  expect((await read(await put("details", details))).status).toBe(200);
}
async function finish() {
  expect((await read(await act({ action: "complete", step: "compliance" }))).status).toBe(200);
  expect((await read(await put("treasury", treasury))).status).toBe(200);
  expect((await read(await put("settlement", settlement([80, 15, 5])))).status).toBe(200);
}
/** Officer approves every document and the case. */
async function approveAll() {
  as("officer-1");
  const c = (await read(await QUEUE(json("GET", undefined, `${URL_}/review?owner=owner-1`)))).body;
  for (const d of c.state.documents) expect((await decide({ action: "approve_document", owner: "owner-1", documentId: d.id })).status).toBe(200);
  const r = await read(await decide({ action: "approve_case", owner: "owner-1", reason: "Documents and screening in order" }));
  as("owner-1");
  return r;
}

beforeEach(() => {
  resetDevelopmentStore();
  m.as = "owner-1";
  m.accounts = {
    "owner-1": { user: { id: "owner-1", name: "Avery Quinn", kycStatus: "unverified" }, roles: ["user"] },
    "owner-2": { user: { id: "owner-2", name: "Blake Rowe", kycStatus: "verified" }, roles: ["user"] },
    "officer-1": { user: { id: "officer-1", name: "Casey Officer", kycStatus: "verified" }, roles: ["user", "compliance_officer"] },
  };
  m.hits = [];
  m.fail = false;
  m.calls = 0;
  m.events = [];
});

describe("onboarding routes", () => {
  it("starts empty and resumes at the first step", async () => {
    const v = await view();
    expect(v.resume).toBe("business");
    expect(v.progress.pct).toBe(0);
    expect(v.environment).toBeDefined();
  });

  it("refuses to skip ahead and rejects invalid data", async () => {
    expect((await read(await put("details", details))).status).toBe(409);
    expect((await read(await put("business", { ...business, country: "KP" }))).status).toBe(422);
  });

  it("keeps an unfinished form as a draft only", async () => {
    const r = await read(await put("business", { legalName: "Half" }, false));
    expect(r.body.state.drafts.business.legalName).toBe("Half");
    expect(r.body.state.business).toBeUndefined();
    expect(r.body.state.completed).toEqual([]);
  });

  it("identity needs the required documents; content is sniffed", async () => {
    await put("business", business);
    const blocked = await read(await put("identity", identity));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Certificate of Incorporation/);
    expect((await upload("incorporation", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status).toBe(415);
  });

  it("removing a required document reopens identity", async () => {
    await profile();
    const doc = (await view()).state.documents[0];
    expect((await REMOVE(new NextRequest(`${URL_}/documents?id=${doc.id}`, { method: "DELETE" }))).status).toBe(200);
    expect((await view()).state.completed).not.toContain("identity");
  });

  it("verification refuses honestly when no provider is configured", async () => {
    await put("business", business);
    const r = await read(await act({ action: "verify" }));
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/no verification provider is configured/);
  });

  it("completing identity submits the case for compliance review", async () => {
    await profile();
    const v = await view();
    expect(v.state.review.status).toBe("pending");
    expect(m.events.map((e) => e.event)).toEqual(expect.arrayContaining(["settlement.onboarding.started", "settlement.onboarding.step_completed", "settlement.onboarding.document_uploaded", "settlement.onboarding.review_requested"]));
  });
});

describe("screening", () => {
  it("success: a clear result lets compliance complete", async () => {
    await profile();
    expect((await read(await act({ action: "complete", step: "compliance" }))).status).toBe(409); // not run yet
    const r = await read(await act({ action: "screen" }));
    expect(r.status).toBe(200);
    expect(r.body.state.screening.status).toBe("clear");
    expect(r.body.state.screening.requestKey).toMatch(/^[0-9a-f]{64}$/);
    expect(m.calls).toBe(3); // legal name, owner, representative
    expect((await read(await act({ action: "complete", step: "compliance" }))).status).toBe(200);
    expect(m.events.map((e) => e.event)).toEqual(expect.arrayContaining(["settlement.onboarding.screening_requested", "settlement.onboarding.screening_completed"]));
  });

  it("repeat request with unchanged inputs reuses the stored result", async () => {
    await profile();
    await act({ action: "screen" });
    const again = await read(await act({ action: "screen" }));
    expect(again.body.reused).toBe(true);
    expect(m.calls).toBe(3);
  });

  it("concurrent requests run the provider once", async () => {
    await profile();
    const [a, b] = await Promise.all([act({ action: "screen" }), act({ action: "screen" })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(m.calls).toBe(3);
    const reused = [(await read(a)).body.reused, (await read(b)).body.reused].sort();
    expect(reused).toEqual([false, true]);
  });

  it("provider failure is recorded as unavailable, never clear, and can be retried", async () => {
    await profile();
    m.fail = true;
    const r = await read(await act({ action: "screen" }));
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/^Screening unavailable/);
    expect(r.body.state.screening.status).toBe("failed");
    expect(r.body.readiness.blockers).toContain("screening_unavailable");
    expect((await read(await act({ action: "complete", step: "compliance" }))).status).toBe(409);
    expect(m.events.some((e) => e.event === "settlement.onboarding.screening_failed")).toBe(true);
    m.fail = false;
    const retry = await read(await act({ action: "screen" }));
    expect(retry.body.reused).toBe(false); // a failure is never reused
    expect(retry.body.state.screening.status).toBe("clear");
  });

  it("a potential match goes to manual review and cannot be re-rolled by the applicant", async () => {
    await profile();
    m.hits = [{ name: "NORTH WAY", matchScore: 0.87, sources: ["OFAC_SDN"] }];
    expect((await read(await act({ action: "screen" }))).body.state.screening.status).toBe("potential_match");
    m.hits = [];
    const again = await read(await act({ action: "screen" }));
    expect(again.body.reused).toBe(true);
    expect(again.body.state.screening.status).toBe("potential_match");
    expect((await read(await act({ action: "complete", step: "compliance" }))).status).toBe(409);
  });

  it("editing a screened step invalidates the screening", async () => {
    await profile();
    await act({ action: "screen" });
    await act({ action: "complete", step: "compliance" });
    const edited = await read(await put("business", { ...business, legalName: "Northwind Group Ltd" }));
    expect(edited.body.state.screening).toBeUndefined();
    expect(edited.body.state.completed).not.toContain("compliance");
  });
});

describe("activation", () => {
  it("blocked by identity, documents and review, with explicit codes", async () => {
    await profile();
    await act({ action: "screen" });
    await finish();
    const a = await read(await act({ action: "activate" }));
    expect(a.status).toBe(409);
    expect(a.body.eligible).toBe(false);
    expect(a.body.blockers).toEqual(expect.arrayContaining(["identity_verification_pending", "identity_provider_not_configured", "documents_pending_review", "compliance_review_pending"]));
    expect(a.body.state.activation.status).toBe("REQUIRES_ACTION");
    expect(m.events.some((e) => e.event === "settlement.onboarding.activation_blocked")).toBe(true);
  });

  it("blocked by a pending screening match even when everything else holds", async () => {
    m.accounts["owner-1"].user.kycStatus = "verified";
    await profile();
    m.hits = [{ name: "NORTH WAY", matchScore: 0.87, sources: ["OFAC_SDN"] }];
    await act({ action: "screen" });
    // compliance cannot complete, so settlement can't be reached; activation lists the screening gate
    const a = await read(await act({ action: "activate" }));
    expect(a.body.blockers).toContain("screening_pending_review");
  });

  it("blocked by identity alone when review, documents and screening are approved", async () => {
    await profile();
    await act({ action: "screen" });
    await finish();
    await approveAll();
    const a = await read(await act({ action: "activate" }));
    expect(a.status).toBe(409);
    expect(a.body.blockers).toEqual(["identity_verification_pending", "identity_provider_not_configured"]);
  });

  it("succeeds only when every gate passes", async () => {
    m.accounts["owner-1"].user.kycStatus = "verified";
    await profile();
    await act({ action: "screen" });
    await finish();
    expect((await read(await act({ action: "activate" }))).status).toBe(409);
    expect((await approveAll()).status).toBe(200);
    const a = await read(await act({ action: "activate" }));
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ eligible: true, blockers: [] });
    expect(a.body.state.activation.status).toBe("ACTIVE");
    expect(m.events.some((e) => e.event === "settlement.onboarding.activated")).toBe(true);
    // verified business details are locked once active
    expect((await read(await put("business", { ...business, legalName: "Other Ltd" }))).status).toBe(409);
  });

  it("invalid settlement rules are refused", async () => {
    await profile();
    await act({ action: "screen" });
    await act({ action: "complete", step: "compliance" });
    await put("treasury", treasury);
    expect((await read(await put("settlement", settlement([80, 15])))).status).toBe(422); // 95%
  });

  it("a client that bypasses the editor cannot store an invalid split", async () => {
    await profile();
    await act({ action: "screen" });
    await act({ action: "complete", step: "compliance" });
    await put("treasury", treasury);
    const base = settlement([80, 15, 5]);
    const attempts = [
      settlement([80, 30, 5]), // 115%
      settlement([-1, 101]), // sums to 100, out of range
      { ...base, rules: [{ ...base.rules[0], percent: 97.5 }, { ...base.rules[1], percent: 2.5 }] },
      { ...base, rules: [{ ...base.rules[0], percent: "100" }] },
      { ...base, rules: [{ ...base.rules[0], percent: 100, destination: "attacker_wallet" }] },
      { ...base, rules: [{ ...base.rules[0], percent: 100, address: "0x000000000000000000000000000000000000dEaD" }] },
      { ...base, rules: [] },
    ];
    for (const data of attempts) {
      const r = await read(await put("settlement", data));
      expect(r.status).toBe(422);
    }
    const v = await view();
    expect(v.state.settlement).toBeUndefined();
    expect(v.state.completed).not.toContain("settlement");
    expect((await read(await put("settlement", settlement([0, 100])))).status).toBe(200);
  });
});

describe("compliance review", () => {
  it("is limited to compliance officers", async () => {
    await profile();
    as("owner-2");
    expect((await QUEUE(json("GET", undefined, `${URL_}/review`))).status).toBe(403);
    expect((await decide({ action: "approve_case", owner: "owner-1" })).status).toBe(403);
    as("missing");
    expect((await QUEUE(json("GET", undefined, `${URL_}/review`))).status).toBe(401);
  });

  it("lists pending cases for an officer", async () => {
    await profile();
    as("officer-1");
    const q = (await read(await QUEUE(json("GET", undefined, `${URL_}/review`)))).body;
    expect(q.cases.map((c: { ownerId: string }) => c.ownerId)).toEqual(["owner-1"]);
    expect(q.cases[0].review).toBe("pending");
  });

  it("an officer cannot review their own case", async () => {
    as("officer-1");
    await profile(); // officer-1 applies for themselves
    const doc = (await view()).state.documents[0];
    expect((await decide({ action: "approve_document", owner: "officer-1", documentId: doc.id })).status).toBe(403);
    expect((await decide({ action: "approve_case", owner: "officer-1" })).status).toBe(403);
    expect((await OPEN_DOC(json("GET", undefined, `${URL_}/review/document?owner=officer-1&id=${doc.id}`))).status).toBe(403);
  });

  it("decisions record reviewer, time and reason, and are audited", async () => {
    await profile();
    const doc = (await view()).state.documents[0];
    as("officer-1");
    expect((await decide({ action: "reject_document", owner: "owner-1", documentId: doc.id })).status).toBe(400); // reason required
    const r = await read(await decide({ action: "reject_document", owner: "owner-1", documentId: doc.id, reason: "Document is illegible" }));
    expect(r.status).toBe(200);
    const d = r.body.state.documents.find((x: { id: string }) => x.id === doc.id);
    expect(d).toMatchObject({ review: "rejected", reviewedBy: "officer-1", reviewReason: "Document is illegible" });
    expect(Date.parse(d.reviewedAt)).toBeGreaterThan(0);
    expect(r.body.state.review.history.at(-1)).toMatchObject({ by: "officer-1", action: "reject_document", reason: "Document is illegible", target: doc.kind });
    expect(m.events.at(-1)).toMatchObject({ event: "settlement.onboarding.review_document_decided", actor: "officer-1", fields: { owner: "owner-1", action: "reject_document" } });
  });

  it("approval requires approved documents and a clear screening", async () => {
    await profile();
    as("officer-1");
    expect((await read(await decide({ action: "approve_case", owner: "owner-1" }))).body.error).toMatch(/Approve the required documents first/);
    as("owner-1");
    m.hits = [{ name: "NORTH WAY", matchScore: 0.87, sources: ["OFAC_SDN"] }];
    await act({ action: "screen" });
    as("officer-1");
    const c = (await read(await QUEUE(json("GET", undefined, `${URL_}/review?owner=owner-1`)))).body;
    for (const d of c.state.documents) await decide({ action: "approve_document", owner: "owner-1", documentId: d.id });
    expect((await read(await decide({ action: "approve_case", owner: "owner-1" }))).body.error).toMatch(/screening must be clear/);
    expect((await decide({ action: "clear_screening", owner: "owner-1" })).status).toBe(400); // reason required
    const cleared = await read(await decide({ action: "clear_screening", owner: "owner-1", reason: "Different entity: name and country differ" }));
    expect(cleared.body.state.screening).toMatchObject({ status: "cleared_by_review", review: { by: "officer-1" } });
    expect((await decide({ action: "approve_case", owner: "owner-1" })).status).toBe(200);
  });

  it("a confirmed match blocks the case", async () => {
    await profile();
    m.hits = [{ name: "NORTH WAY", matchScore: 0.95, sources: ["OFAC_SDN"] }];
    await act({ action: "screen" });
    as("officer-1");
    const r = await read(await decide({ action: "confirm_match", owner: "owner-1", reason: "Confirmed against SDN entry" }));
    expect(r.body.state.screening.status).toBe("confirmed_match");
    expect(r.body.state.review.status).toBe("rejected");
    expect(r.body.readiness.blockers).toEqual(expect.arrayContaining(["screening_blocked", "compliance_review_rejected"]));
  });

  it("request changes reopens identity; a change after approval reopens review", async () => {
    await profile();
    await act({ action: "screen" });
    as("officer-1");
    const r = await read(await decide({ action: "request_changes", owner: "owner-1", reason: "Upload a clearer proof of address" }));
    expect(r.body.state.review.status).toBe("changes_requested");
    expect(r.body.state.completed).not.toContain("identity");
    as("owner-1");
    expect((await read(await put("identity", identity))).body.state.review.status).toBe("pending");

    await act({ action: "screen" });
    await finish();
    await approveAll();
    expect((await view()).state.review.status).toBe("approved");
    const edited = await read(await put("details", { ...details, description: "Analytics and consulting." }));
    expect(edited.body.state.review.status).toBe("pending");
  });
});

describe("document access", () => {
  it("applicants cannot read documents back; officers can, and it is audited", async () => {
    await profile();
    const doc = (await view()).state.documents[0];
    const url = `${URL_}/review/document?owner=owner-1&id=${doc.id}`;
    as("owner-2"); // another applicant
    expect((await OPEN_DOC(json("GET", undefined, url))).status).toBe(403);
    as("owner-1"); // the owner themselves has no read path either
    expect((await OPEN_DOC(json("GET", undefined, url))).status).toBe(403);
    as("officer-1");
    const r = await OPEN_DOC(json("GET", undefined, url));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(m.events.at(-1)).toMatchObject({ event: "settlement.onboarding.review_document_opened", actor: "officer-1" });
  });

  it("documents are owner-scoped: another account's document id is not found", async () => {
    await profile();
    const doc = (await view()).state.documents[0];
    as("officer-1");
    expect((await OPEN_DOC(json("GET", undefined, `${URL_}/review/document?owner=owner-2&id=${doc.id}`))).status).toBe(404);
    as("owner-2");
    expect((await REMOVE(new NextRequest(`${URL_}/documents?id=${doc.id}`, { method: "DELETE" }))).status).toBe(404);
  });
});
