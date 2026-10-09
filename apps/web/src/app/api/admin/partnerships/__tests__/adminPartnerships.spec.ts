import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ allowed: true, sbRpc: vi.fn(), sbSelect: vi.fn(), sbInsert: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async (_r: unknown, role: string) => h.allowed && role === "admin"
    ? { ok: true, account: { user: { id: "u1", email: "admin@example.test" } } }
    : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbSelect: h.sbSelect, sbInsert: h.sbInsert, sbUpdate: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { GET, PATCH } from "../route";

// Staff inquiry route: admin only, compare-and-set status changes, actor recorded.
const ID = "11111111-1111-4111-8111-111111111111";
const req = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
beforeEach(() => {
  h.allowed = true;
  for (const f of [h.sbRpc, h.sbSelect, h.sbInsert]) f.mockReset();
  h.sbSelect.mockImplementation(async (t: string) => (t === "partnership_inquiries" ? [{ id: ID, status: "reviewing" }] : []));
});

describe("/api/admin/partnerships", () => {
  it("refuses anyone without the admin role (and reads nothing)", async () => {
    h.allowed = false;
    expect((await GET(req("GET", "/api/admin/partnerships"))).status).toBe(403);
    expect((await PATCH(req("PATCH", "/api/admin/partnerships", { action: "note", id: ID, note: "hi" }))).status).toBe(403);
    expect(h.sbSelect).not.toHaveBeenCalled();
  });
  it("validates filters", async () => {
    expect((await GET(req("GET", "/api/admin/partnerships?status=hacked"))).status).toBe(400);
    expect((await GET(req("GET", "/api/admin/partnerships?id=not-a-uuid"))).status).toBe(400);
  });
  it("changes status only from the status the operator saw, recording who", async () => {
    h.sbRpc.mockResolvedValue(true);
    const ok = await PATCH(req("PATCH", "/api/admin/partnerships", { action: "status", id: ID, from: "new", to: "reviewing", note: "first look" }));
    expect(ok.status).toBe(200);
    expect(h.sbRpc).toHaveBeenCalledWith("partnership_inquiry_set_status", { p_id: ID, p_from: "new", p_to: "reviewing", p_actor: "admin@example.test", p_note: "first look" });
    h.sbRpc.mockResolvedValue(false);
    expect((await PATCH(req("PATCH", "/api/admin/partnerships", { action: "status", id: ID, from: "new", to: "contacted" }))).status).toBe(409);
  });
  it("adds notes with the actor; refuses empty notes and extra fields", async () => {
    h.sbInsert.mockResolvedValue([{}]);
    expect((await PATCH(req("PATCH", "/api/admin/partnerships", { action: "note", id: ID, note: "Called them" }))).status).toBe(200);
    expect(h.sbInsert).toHaveBeenCalledWith("partnership_inquiry_activity", { inquiry_id: ID, kind: "note", note: "Called them", actor: "admin@example.test" });
    expect((await PATCH(req("PATCH", "/api/admin/partnerships", { action: "note", id: ID, note: " " }))).status).toBe(400);
    expect((await PATCH(req("PATCH", "/api/admin/partnerships", { action: "note", id: ID, note: "x", status: "accepted" }))).status).toBe(400);
  });
});
