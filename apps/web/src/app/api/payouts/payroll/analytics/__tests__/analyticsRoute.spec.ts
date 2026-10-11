import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ user: "u-employer" as string | null, analytics: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireUser: vi.fn(async () => (h.user ? { ok: true, account: { user: { id: h.user } } } : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) })),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/payroll/analytics", () => ({ payrollAnalytics: h.analytics }));

import { GET } from "../route";

const get = (qs = "") => GET(new NextRequest(`https://furlpay.com/api/payouts/payroll/analytics${qs}`));

beforeEach(() => {
  h.user = "u-employer";
  h.analytics.mockReset().mockResolvedValue({ totals: {} });
});

describe("/api/payouts/payroll/analytics", () => {
  it("requires a session and never reads storage without one", async () => {
    h.user = null;
    expect((await get()).status).toBe(401);
    expect(h.analytics).not.toHaveBeenCalled();
  });

  it("is scoped to the session's employer; a merchant in the query is refused", async () => {
    expect((await get("?months=3")).status).toBe(200);
    expect(h.analytics).toHaveBeenCalledWith("u-employer", 3);
    expect((await get("?merchant_id=someone-else")).status).toBe(400);
  });

  it("defaults to 6 months and refuses anything outside 1-24", async () => {
    await get();
    expect(h.analytics).toHaveBeenLastCalledWith("u-employer", 6);
    for (const bad of ["0", "25", "1.5", "abc", "-3"]) expect((await get(`?months=${bad}`)).status, bad).toBe(400);
  });

  it("answers 503 without detail when storage fails", async () => {
    h.analytics.mockRejectedValueOnce(new Error("PGRST: relation payroll_batches does not exist"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/PGRST|relation/);
  });
});
