import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// The schedules route: session required, the session's user is the only owner
// it ever passes on, bodies are strict, and errors map to 409/503 without
// leaking internals.
const h = vi.hoisted(() => ({ user: "u-employer" as string | null, list: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireUser: vi.fn(async () => (h.user ? { ok: true, account: { user: { id: h.user } } } : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) })),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/payroll/schedule", async (orig) => ({
  ...(await orig<typeof import("@/lib/payroll/schedule")>()),
  listSchedules: h.list, createSchedule: h.create, updateSchedule: h.update,
}));

import { GET, POST, PATCH } from "../route";
import { PayrollConflict } from "@/lib/payroll/repository";

const URL = "https://furlpay.com/api/payouts/payroll/schedules";
const req = (method: string, body?: unknown) =>
  new NextRequest(URL, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const valid = {
  requestId: "44444444-4444-4444-8444-444444444444", name: "Team", chain: "arbitrum", cadence: "weekly",
  startOn: "2099-01-05", lines: [{ contractorId: "33333333-3333-4333-8333-333333333333" }],
};

beforeEach(() => {
  h.user = "u-employer";
  for (const f of [h.list, h.create, h.update]) f.mockReset();
});

describe("/api/payouts/payroll/schedules", () => {
  it("refuses every method without a session, before touching storage", async () => {
    h.user = null;
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await POST(req("POST", valid))).status).toBe(401);
    expect((await PATCH(req("PATCH", { id: valid.requestId, action: "pause" }))).status).toBe(401);
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("always acts as the session's user — an owner in the body is refused, not honoured", async () => {
    h.list.mockResolvedValue([]);
    await GET(req("GET"));
    expect(h.list).toHaveBeenCalledWith("u-employer");
    expect((await POST(req("POST", { ...valid, merchantId: "someone-else" }))).status).toBe(400);
    h.create.mockResolvedValue({ id: valid.requestId });
    expect((await POST(req("POST", valid))).status).toBe(201);
    expect(h.create.mock.calls[0][0]).toBe("u-employer");
  });

  it("refuses an auto-pay or signing field: schedules can only prepare drafts", async () => {
    for (const extra of [{ autoSubmit: true }, { autoSign: true }, { signature: "0x" + "1".repeat(130) }]) {
      expect((await POST(req("POST", { ...valid, ...extra }))).status).toBe(400);
    }
    expect(h.create).not.toHaveBeenCalled();
  });

  it("validates PATCH actions strictly", async () => {
    expect((await PATCH(req("PATCH", { id: valid.requestId, action: "submit" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { id: "not-a-uuid", action: "cancel" }))).status).toBe(400);
    h.update.mockResolvedValue(null);
    expect((await PATCH(req("PATCH", { id: valid.requestId, action: "cancel" }))).status).toBe(404);
  });

  it("maps a conflict to 409 with its message and anything else to a generic 503", async () => {
    h.create.mockRejectedValueOnce(new PayrollConflict("Ada is inactive"));
    const c = await POST(req("POST", valid));
    expect(c.status).toBe(409);
    expect((await c.json()).error).toBe("Ada is inactive");
    h.create.mockRejectedValueOnce(new Error("supabase 500: relation payroll_schedules does not exist at ... service_role key ..."));
    const u = await POST(req("POST", valid));
    expect(u.status).toBe(503);
    expect(JSON.stringify(await u.json())).not.toMatch(/service_role|relation/);
  });
});
