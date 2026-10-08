import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Through the real handler and the development onboarding store. Doubles: the
// role lookup and the rate limiter. Accounts are test fixtures.
const m = vi.hoisted(() => ({ roles: [] as string[], signedIn: true }));
vi.mock("@/lib/authz", () => ({
  requireRole: async (_req: unknown, role: string) =>
    !m.signedIn
      ? { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
      : m.roles.includes(role)
        ? { ok: true, account: { user: { id: "officer-1", name: "Casey Officer", kycStatus: "verified" } } }
        : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));

import { GET } from "../route";
import { resetDevelopmentStore, updateState } from "@/lib/settlement/onboardingStore";

const req = () => new NextRequest("https://furlpay.com/api/compliance/overview");

beforeEach(() => {
  resetDevelopmentStore();
  m.roles = ["user", "compliance_officer"];
  m.signedIn = true;
});

describe("GET /api/compliance/overview", () => {
  it("refuses signed-out callers and non-officers", async () => {
    m.signedIn = false;
    expect((await GET(req())).status).toBe(401);
    m.signedIn = true;
    m.roles = ["user"];
    expect((await GET(req())).status).toBe(403);
  });

  it("reports unavailable sources as null with a reason, never as zero", async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    // tests run without SUPABASE_URL: no durable user store
    expect(body.users).toEqual({ total: null, verified: null, unavailable: expect.any(String) });
    expect(body.settlement.usdcSettled30d).toBeNull();
    expect(body.onboarding.cases).toBe(0);
    expect(body.health.level).toBeDefined();
  });

  it("aggregates real onboarding records", async () => {
    await updateState("owner-a", (s) => ({ ...s, review: { status: "pending", history: [] }, screening: { screenedAt: new Date().toISOString(), list: "OFAC SDN", names: 2, matches: [{ name: "X", score: 0.9, source: "OFAC_SDN" }], status: "potential_match" } }));
    await updateState("owner-b", (s) => ({ ...s, review: { status: "approved", history: [] } }));
    const body = await (await GET(req())).json();
    expect(body.onboarding).toMatchObject({ cases: 2, pendingReview: 1, approved: 1, openAlerts: 2, truncated: false });
    expect(body.onboarding.screening.potentialMatch).toBe(1);
  });
});
