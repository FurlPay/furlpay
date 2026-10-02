import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { GET as devSession } from "@/app/api/auth/dev-session/route";
import { GET as profileGET } from "@/app/api/profile/route";
import { PUT as usernamePUT } from "@/app/api/profile/username/route";
import { GET as overviewGET } from "@/app/api/overview/route";
import { GET as kpisGET } from "@/app/api/ops/analytics/kpis/route";
import { POST as cancelPOST } from "@/app/api/travel/cancel/[id]/route";
import { listTrips } from "@/lib/travel/store";

// Production authentication, with every development switch turned ON at once.
// NODE_ENV=production must win over all of them.

afterEach(() => vi.unstubAllEnvs());

let ip = 0;
const req = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: { "x-real-ip": `198.51.100.${(ip++ % 200) + 1}`, ...(init.headers ?? {}) },
  });

function productionWithDevFlags() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
  vi.stubEnv("NEXT_PUBLIC_ALLOW_GUEST", "1");
}

describe("pages: production redirects to /login whatever the dev flags say", () => {
  it.each(["/analytics", "/analytics/users", "/profile", "/spending"])("%s", async (path) => {
    productionWithDevFlags();
    const res = await middleware(req(path));
    const loc = new URL(res!.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe(path);
  });
});

describe("dev-only route", () => {
  it("GET /api/auth/dev-session is 404 in production and sets no cookie", async () => {
    productionWithDevFlags();
    const res = await devSession(req("/api/auth/dev-session?next=/analytics"));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("APIs authorize on their own (no reliance on page redirects)", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET /api/profile", () => profileGET(req("/api/profile"))],
    ["GET /api/overview", () => overviewGET(req("/api/overview"))],
    ["GET /api/ops/analytics/kpis", () => kpisGET(req("/api/ops/analytics/kpis"))],
    [
      "PUT /api/profile/username",
      () => usernamePUT(req("/api/profile/username", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "abc" }) })),
    ],
  ];
  it.each(cases)("%s without a credential → 401", async (_name, call) => {
    productionWithDevFlags();
    expect((await call()).status).toBe(401);
  });

  it.each(["Bearer not-a-jwt", "Bearer ", "Bearer eyJhbGciOiJub25lIn0.e30."])("malformed credential %j → 401", async (authorization) => {
    productionWithDevFlags();
    const res = await profileGET(req("/api/profile", { headers: { authorization } }));
    expect(res.status).toBe(401);
  });
});

describe("deployment configuration cannot enable development shortcuts", () => {
  const ROOT = join(process.cwd(), "..", "..");
  it.each(["infra/aws/env-contract.json", "infra/aws/modules/env/compute.tf", "apps/web/vercel.json"])("%s never sets them", (rel) => {
    const text = readFileSync(join(ROOT, rel), "utf8");
    expect(text).not.toMatch(/FURLPAY_DEV_AUTO_LOGIN|ALLOW_GUEST_LOGIN|NEXT_PUBLIC_ALLOW_GUEST/);
  });
});

describe("travel: no invented trips or refunds in production", () => {
  it("a new user's My Trips is empty in production (demo trips are development-only)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(listTrips(`prod-${randomUUID()}`)).toEqual([]);
  });

  it("development still seeds the demo trips", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(listTrips(`dev-${randomUUID()}`).length).toBe(3);
  });

  it("cancellation requires a session, then is refused in production (no refund rail)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await cancelPOST(req("/api/travel/cancel/x", { method: "POST" }), { params: Promise.resolve({ id: "x" }) })).status).toBe(401);
  });
});
