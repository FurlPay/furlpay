import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ sbRpc: vi.fn(), sbUpdate: vi.fn(), sbSelect: vi.fn(), sbInsert: vi.fn(), backend: "supabase", send: vi.fn(), logs: [] as unknown[], limited: null as Response | null }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbUpdate: h.sbUpdate, sbSelect: h.sbSelect, sbInsert: h.sbInsert, get supabaseBackend() { return h.backend; } }));
vi.mock("@/lib/email", () => ({ sendEmail: h.send }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => h.limited) }));
vi.mock("@/lib/log", () => ({ log: { info: (...a: unknown[]) => h.logs.push(a), warn: (...a: unknown[]) => h.logs.push(a), error: (...a: unknown[]) => h.logs.push(a) } }));

import { normalizeContact, normalizeWebsite, validateInquiry, PARTNERSHIP_INTERESTS } from "../model";
import { listInquiries, submitInquiry } from "../repository";
import { POST } from "@/app/api/partnerships/inquiries/route";

const valid = { company: "Acme Settlement Labs", workEmail: "Ops@Acme.example", contactMethod: "telegram", contactDetail: "@acme_ops", fullName: "Ada Byron", jobTitle: "CTO", website: "acme.example", interest: "cross-border-settlement", message: "Corridors into SEA.", source: "partners_card", companySite: "", elapsedMs: 9000 };
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/partnerships/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  for (const f of [h.sbRpc, h.sbUpdate, h.sbSelect, h.sbInsert, h.send]) f.mockReset();
  h.backend = "supabase"; h.logs.length = 0; h.limited = null;
  h.sbRpc.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", duplicate: false }]);
  h.sbUpdate.mockResolvedValue([{}]);
});
afterEach(() => vi.unstubAllEnvs());

describe("contact and website normalisation", () => {
  it.each([
    ["telegram", "@acme_ops", "@acme_ops"], ["telegram", "https://t.me/AcmeOps", "@AcmeOps"],
    ["whatsapp", "+65 8123-4567", "+6581234567"], ["email", "", "ops@acme.example"], ["email", "Sales@Acme.example", "sales@acme.example"],
    ["linkedin", "linkedin.com/in/ada-byron/", "https://www.linkedin.com/in/ada-byron"], ["discord", "Acme.Ops", "acme.ops"], ["other", "Signal: +65 8123 4567", "Signal: +65 8123 4567"],
  ])("%s %j → %j", (method, raw, out) => {
    expect(normalizeContact(method as never, raw, "ops@acme.example")).toEqual({ value: out });
  });
  it.each([["telegram", "ab"], ["whatsapp", "81234567"], ["linkedin", "https://evil.example/in/x"], ["linkedin", "https://linkedin.com.evil.example/in/x"], ["discord", "a..b"], ["other", "x"]])("rejects %s %j", (method, raw) => {
    expect(normalizeContact(method as never, raw, "ops@acme.example")).toHaveProperty("error");
  });
  it("websites: adds https, refuses other schemes and junk", () => {
    expect(normalizeWebsite("acme.example")).toEqual({ value: "https://acme.example/" });
    expect(normalizeWebsite("")).toEqual({ value: null });
    expect(normalizeWebsite("javascript:alert(1)")).toHaveProperty("error");
    expect(normalizeWebsite("not a site")).toHaveProperty("error");
    expect(normalizeWebsite("https://user:pass@acme.example")).toHaveProperty("error");
    expect(normalizeWebsite("https://acme.example/" + "é".repeat(100))).toHaveProperty("error");
  });
  it("has twelve partnership categories with unique ids", () => {
    expect(new Set(PARTNERSHIP_INTERESTS.map(i => i.id)).size).toBe(12);
  });
});

describe("validateInquiry", () => {
  it("normalises a valid inquiry into the stored row", () => {
    const r = validateInquiry(valid);
    expect(r).toMatchObject({ ok: true, row: { work_email: "ops@acme.example", contact_detail: "@acme_ops", website: "https://acme.example/", partnership_interest: "cross-border-settlement", source_page: "partners_card" } });
  });
  it("reports every problem by field", () => {
    const r = validateInquiry({ ...valid, company: "", workEmail: "nope", interest: undefined });
    expect(r.ok).toBe(false);
    expect(Object.keys((r as { errors: object }).errors).sort()).toEqual(["company", "interest", "workEmail"]);
  });
  it("refuses unknown fields and a filled honeypot", () => {
    expect(validateInquiry({ ...valid, admin: true }).ok).toBe(false);
    expect(validateInquiry({ ...valid, companySite: "spam.example" })).toMatchObject({ ok: false, errors: { companySite: expect.any(String) } });
  });
});

describe("POST /api/partnerships/inquiries", () => {
  it("stores the inquiry and answers 201 with its id", async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111", duplicate: false });
    expect(h.sbRpc).toHaveBeenCalledWith("partnership_inquiry_submit", { p: expect.objectContaining({ company_name: "Acme Settlement Labs", work_email: "ops@acme.example" }) });
  });
  it("a same-day duplicate returns the first inquiry (200) and sends nothing new", async () => {
    h.sbRpc.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", duplicate: true }]);
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("400 with field errors for a bad submission; nothing stored", async () => {
    const res = await post({ ...valid, contactMethod: "whatsapp", contactDetail: "12345" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toHaveProperty("contactDetail");
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("bot traps: honeypot or a too-fast form is rejected without detail", async () => {
    for (const body of [{ ...valid, companySite: "x" }, { ...valid, elapsedMs: 300 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Submission rejected." });
    }
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("no storage → 503 that says nothing was submitted (never a pretend success)", async () => {
    h.backend = "none";
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/nothing was submitted/);
  });
  it("an uncertain database outcome asks for a safe retry without leaking the failing row", async () => {
    h.sbRpc.mockRejectedValue(new Error("failing row: Ada Byron ops@acme.example"));
    const res = await post(valid);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not confirm receipt/);
    expect(JSON.stringify(h.logs)).not.toContain("ops@acme.example");
  });
  it("honours the rate limit", async () => {
    h.limited = new Response("slow down", { status: 429 }) as never;
    expect((await post(valid)).status).toBe(429);
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("never logs personal data", async () => {
    await post(valid);
    const logged = JSON.stringify(h.logs);
    for (const pii of ["acme.example", "Ada", "acme_ops", "Corridors", "Acme Settlement"]) expect(logged).not.toContain(pii);
  });
  it("rejects malformed JSON and UTF-8 payloads over the byte cap", async () => {
    const bad = await POST(new NextRequest("http://localhost/api/partnerships/inquiries", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
    expect((await post({ ...valid, message: "€".repeat(6000) })).status).toBe(413);
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
});

describe("internal notification is recorded truthfully", () => {
  const row = validateInquiry(valid);
  if (!row.ok) throw new Error("fixture invalid");
  it("no inbox or no email provider → not_configured (not 'sent')", async () => {
    expect((await submitInquiry(row.row)).notification).toBe("not_configured");
    expect(h.sbUpdate).toHaveBeenCalledWith("partnership_inquiries", expect.any(String), { notification_state: "not_configured", notified_at: null });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("sent only when the provider accepted it; a failure is recorded as failed and the inquiry still stands", async () => {
    vi.stubEnv("PARTNERSHIPS_NOTIFY_EMAIL", "team@example.test"); vi.stubEnv("RESEND_API_KEY", "re_test");
    h.send.mockResolvedValue({ ok: true, id: "e1" });
    expect((await submitInquiry(row.row)).notification).toBe("sent");
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: "team@example.test", replyTo: "ops@acme.example", idempotencyKey: "partnership-inquiry:11111111-1111-4111-8111-111111111111" }));
    h.send.mockResolvedValue({ ok: false, error: "domain not verified" });
    expect((await submitInquiry(row.row)).notification).toBe("failed");
    h.send.mockRejectedValue(new Error("network"));
    expect(await submitInquiry(row.row)).toMatchObject({ id: expect.any(String), notification: "failed" });
  });
  it("escapes the message in the HTML email", async () => {
    vi.stubEnv("PARTNERSHIPS_NOTIFY_EMAIL", "team@example.test"); vi.stubEnv("RESEND_API_KEY", "re_test");
    h.send.mockResolvedValue({ ok: true });
    await submitInquiry({ ...row.row, additional_information: "<img src=x onerror=alert(1)>" });
    expect(h.send.mock.calls[0][0].html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h.send.mock.calls[0][0].html).not.toContain("<img");
  });
});

describe("staff search cannot inject PostgREST syntax", () => {
  it("strips operators and parentheses from the search term", async () => {
    h.sbSelect.mockResolvedValue([]);
    await listInquiries({ q: "acme),status.eq.new,(x*" });
    const q = h.sbSelect.mock.calls[0][1] as string;
    // Commas and parentheses are what start a new PostgREST condition; with them
    // gone the rest is only text inside the ilike pattern. Exactly two conditions remain.
    const or = decodeURIComponent(q.split("&").find(p => p.startsWith("or="))!.slice(3));
    expect(or.slice(1, -1).split(",")).toHaveLength(2);
    expect(or.slice(1, -1)).not.toMatch(/[()]/);
    expect(q.split("&").filter(p => p.startsWith("status="))).toEqual([]);
  });
});
