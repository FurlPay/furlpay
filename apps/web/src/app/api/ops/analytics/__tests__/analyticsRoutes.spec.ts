import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { FOUNDER_ADMIN_EMAIL } from "@/lib/authz";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { signSession } from "@/lib/session";
import { recordTxEvent } from "@/lib/ops/events";
import { recordApiRequest, recordServerError } from "@/lib/analytics/telemetry";
import { __resetDashboardCacheForTests } from "@/lib/analytics/cache";
import { GET as dashboardGET } from "../dashboard/route";
import { GET as kpisGET } from "../kpis/route";
import { GET as funnelGET } from "../funnel/route";
import { GET as geoGET } from "../geo/route";
import { GET as eventsGET } from "../events/route";

// /api/ops/analytics/* through the REAL auth path (signed session → store
// account → requireOpsAdmin), not a mocked guard.

const ROUTES = { dashboard: dashboardGET, kpis: kpisGET, funnel: funnelGET, geo: geoGET, events: eventsGET };

const req = (path: string, token?: string) =>
  new NextRequest(`http://localhost/api/ops/analytics/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function sessionFor(email: string, roles: ("user" | "admin")[]) {
  const { account } = findOrCreateUserByIdentity({ email, name: "Analytics Test" });
  account.user.roles = roles;
  return {
    account,
    token: await signSession({ sub: account.user.id, safe: "0x0", roles, jti: randomUUID() }),
  };
}

beforeEach(() => __resetDashboardCacheForTests());

describe("access control", () => {
  it.each(Object.keys(ROUTES))("%s: anonymous → 401", async (name) => {
    const res = await ROUTES[name as keyof typeof ROUTES](req(`${name}?range=7d`));
    expect(res.status).toBe(401);
  });

  it.each(Object.keys(ROUTES))("%s: signed-in non-admin → 403", async (name) => {
    const { token } = await sessionFor(`plain-${randomUUID()}@example.com`, ["user"]);
    const res = await ROUTES[name as keyof typeof ROUTES](req(`${name}?range=7d`, token));
    expect(res.status).toBe(403);
  });

  it("a forged admin role in a non-bootstrap account is still refused", async () => {
    const { token } = await sessionFor(`fake-admin-${randomUUID()}@example.com`, ["user", "admin"]);
    expect((await dashboardGET(req("dashboard?range=7d", token))).status).toBe(403);
  });

  it.each(Object.keys(ROUTES))("%s: ops admin → 200 with the ops envelope", async (name) => {
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    const res = await ROUTES[name as keyof typeof ROUTES](req(`${name}?range=7d`, token));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("parameters are validated only AFTER the gate (anonymous learns nothing)", async () => {
    expect((await dashboardGET(req("dashboard?range=forever"))).status).toBe(401);
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    expect((await dashboardGET(req("dashboard?range=forever", token))).status).toBe(400);
    expect((await dashboardGET(req("dashboard?range=7d&product=cards", token))).status).toBe(400);
    expect((await dashboardGET(req("dashboard?range=custom&from=2020-01-01&to=2026-01-01", token))).status).toBe(400);
  });
});

describe("data is real, and absent data says so", () => {
  type Body = { data: Record<string, unknown> & { kpis: Record<string, { status: string; data?: { value: number }; reason?: string }> } };

  it("settled ledger events become transactions and volume; failures do not count as volume", async () => {
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    const before = (await (await dashboardGET(req("dashboard?range=24h", token))).json()) as Body;
    const v0 = before.data.kpis.volume.data?.value ?? 0;
    const c0 = before.data.kpis.transactions.data?.value ?? 0;

    const userId = `usr_${randomUUID()}`;
    await recordTxEvent({ rail: "transfers", state: "settled", amountUsd: 125, token: "USDC", userId });
    await recordTxEvent({ rail: "transfers", state: "failed", amountUsd: 9999, token: "USDC", userId });
    __resetDashboardCacheForTests();

    const after = (await (await dashboardGET(req("dashboard?range=24h", token))).json()) as Body;
    expect(after.data.kpis.transactions.data?.value).toBe(c0 + 1);
    expect(after.data.kpis.volume.data?.value).toBeCloseTo(v0 + 125, 6);
  });

  it("without a durable user store, signup-dated metrics are unavailable — not zero", async () => {
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    const body = (await (await dashboardGET(req("dashboard?range=7d", token))).json()) as Body;
    expect(body.data.kpis.newSignups.status).toBe("unavailable");
    expect(body.data.kpis.newSignups.reason).toBeTruthy();
    expect(body.data.kpis.activeUsers.status).toBe("unavailable");
    // Totals the in-memory store CAN answer are answered.
    expect(body.data.kpis.totalUsers.status).toBe("ok");
  });

  it("observability counts recorded API requests and unhandled errors; latency is honestly N/A", async () => {
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    await Promise.all([recordApiRequest(), recordApiRequest(), recordApiRequest(), recordApiRequest()]);
    await recordServerError({ route: "/api/x", routeType: "route", method: "POST", error: "TypeError" });
    __resetDashboardCacheForTests();
    const body = (await (await dashboardGET(req("dashboard?range=24h", token))).json()) as {
      data: { observability: Record<string, { status: string; data?: { total: number; rate?: number } }> };
    };
    const o = body.data.observability;
    expect(o.requests.status).toBe("ok");
    expect(o.requests.data!.total).toBeGreaterThanOrEqual(4);
    expect(o.errors.data!.total).toBeGreaterThanOrEqual(1);
    expect(o.latency.status).toBe("unavailable");
    expect(o.invocations.status).toBe("unavailable");
  });

  it("no user id or email leaves the API; users appear as pseudonyms", async () => {
    const victim = findOrCreateUserByIdentity({ email: `victim-${randomUUID()}@example.com`, name: "Victim" }).account;
    await recordTxEvent({ rail: "lifi", state: "settled", amountUsd: 10, token: "ETH", userId: victim.user.id });
    __resetDashboardCacheForTests();
    const { token } = await sessionFor(FOUNDER_ADMIN_EMAIL!, ["user", "admin"]);
    for (const name of Object.keys(ROUTES)) {
      const text = await (await ROUTES[name as keyof typeof ROUTES](req(`${name}?range=24h`, token))).text();
      expect(text, name).not.toContain(victim.user.id);
      expect(text, name).not.toContain(victim.user.email);
    }
    const feed = (await (await eventsGET(req("events?range=24h&kind=transaction", token))).json()) as {
      data: { data: { items: { user: string }[] } };
    };
    expect(feed.data.data.items.some((i) => /^usr_.{4}….{4}$/.test(i.user))).toBe(true);
  });
});
