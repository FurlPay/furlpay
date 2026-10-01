import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { NextRequest } from "next/server";
import * as auditMod from "@/lib/audit";
import * as alertsMod from "@/lib/ops/financialAlerts";
import { __resetAdminAuditForTests, classifyAdminRequest, recordAdminAccess, recordAdminDenied } from "@/lib/adminAudit";
import { buildEventRow, subjectHash } from "../events";
import { classifyRequest, countsTowardApiErrorRate, visitorId } from "../telemetry";

// ---------------------------------------------------------------------------
// Admin event semantics, product-event hygiene, traffic classification.
// ---------------------------------------------------------------------------

describe("admin events: reads are recorded quietly, mutations are announced", () => {
  let auditSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    __resetAdminAuditForTests();
    auditSpy = vi.spyOn(auditMod, "audit").mockImplementation(() => {});
    alertSpy = vi.spyOn(alertsMod, "raiseFinancialAlert").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("classifies by method", () => {
    expect(classifyAdminRequest("GET")).toBe("ADMIN_READ");
    expect(classifyAdminRequest("head")).toBe("ADMIN_READ");
    expect(classifyAdminRequest("POST")).toBe("ADMIN_MUTATION");
    expect(classifyAdminRequest("DELETE")).toBe("ADMIN_MUTATION");
  });

  it("dashboard polling: one audit record per 5 minutes per path, and NO alert", () => {
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 20; i++) recordAdminAccess("admin-1", "GET", "/api/ops/analytics/dashboard", t0 + i * 15_000);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][0]).toBe("admin.read");
    recordAdminAccess("admin-1", "GET", "/api/ops/analytics/dashboard", t0 + 5 * 60_000 + 1);
    expect(auditSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("every admin mutation is audited AND alerted", () => {
    recordAdminAccess("admin-1", "POST", "/api/ops/controls");
    recordAdminAccess("admin-1", "POST", "/api/ops/controls");
    expect(auditSpy.mock.calls.filter((c) => c[0] === "admin.action")).toHaveLength(2);
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls[0][0]).toBe("admin_action");
  });

  it("a non-admin refused is an authorization record, not an alert", () => {
    recordAdminDenied("user-1", "GET", "/api/ops/analytics/kpis", "missing_role");
    expect(auditSpy.mock.calls[0][0]).toBe("admin.access_denied");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("an admin role on a non-bootstrap account is a SECURITY event and is alerted", () => {
    expect(recordAdminDenied("user-2", "GET", "/analytics", "role_without_bootstrap_email")).toBe("ADMIN_SECURITY_EVENT");
    expect(alertSpy).toHaveBeenCalledWith("auth_anomaly", expect.objectContaining({ reason: "role_without_bootstrap_email" }));
  });
});

describe("product events carry no PII and are idempotent by construction", () => {
  const SECRET = "test-secret-for-subject-hash-0123456789";
  beforeEach(() => vi.stubEnv("FURLPAY_SESSION_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("subject is an HMAC of the identifier, never the identifier", () => {
    const row = buildEventRow({ name: "signup_completed", eventId: "u1", subjectOf: "alice@example.com" });
    expect(row.subject).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("alice");
    expect(subjectHash("alice@example.com")).toBe(row.subject); // stable → links start to completion
    expect(subjectHash("alice@example.com", "other-secret")).not.toBe(row.subject);
  });

  it("metadata passes an allowlist; unknown keys (emails, tokens) are dropped", () => {
    const row = buildEventRow({
      name: "login",
      eventId: "x",
      metadata: { provider: "google", email: "a@b.c", token: "eyJ…", channel: "x".repeat(200) },
    });
    expect(Object.keys(row.metadata).sort()).toEqual(["channel", "provider"]);
    expect(String(row.metadata.channel).length).toBe(40);
  });

  it("a non-uuid user id is dropped, not coerced", () => {
    expect(buildEventRow({ name: "login", eventId: "x", userId: "usr_demo" }).user_id).toBeNull();
    const id = "3d8eff4e-1026-565d-838e-e8e9f6380798";
    expect(buildEventRow({ name: "login", eventId: "x", userId: id }).user_id).toBe(id);
  });

  it("the same business fact yields the same event_id (retries are no-ops)", () => {
    const a = buildEventRow({ name: "kyc_completed", eventId: "user-9" });
    const b = buildEventRow({ name: "kyc_completed", eventId: "user-9" });
    expect(a.event_id).toBe("kyc_completed:user-9");
    expect(b.event_id).toBe(a.event_id);
  });
});

describe("analytics failure never breaks the caller", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("next/server");
  });

  it("an unreachable analytics store: recordProductEvent returns, logs, counts — never throws", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", async (orig) => ({
      ...(await orig<typeof import("@/lib/supabase")>()),
      supabaseBackend: "supabase",
      sbInsertIgnoreDuplicates: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    }));
    const tasks: (() => Promise<void>)[] = [];
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (t: () => Promise<void>) => tasks.push(t) }));
    const ev = await import("../events");
    expect(() => ev.recordProductEvent({ name: "login", eventId: "u:1" })).not.toThrow();
    await Promise.all(tasks.map((t) => t())); // the deferred write runs after the response
    expect(ev.productEventFailures()).toBe(1);
  });

  it("a timeout behaves the same way (bounded at 2 seconds per attempt)", async () => {
    vi.resetModules();
    const slow = vi.fn((_t: string, _r: unknown, signal?: AbortSignal) => new Promise<void>((_res, rej) => signal?.addEventListener("abort", () => rej(new Error("timeout")))));
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<typeof import("@/lib/supabase")>()), supabaseBackend: "supabase", sbInsertIgnoreDuplicates: slow }));
    const tasks: (() => Promise<void>)[] = [];
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (t: () => Promise<void>) => tasks.push(t) }));
    const ev = await import("../events");
    ev.recordProductEvent({ name: "logout", eventId: "u:2" });
    const t0 = Date.now();
    await Promise.all(tasks.map((t) => t()));
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(slow).toHaveBeenCalledTimes(2); // one retry, then give up
  }, 10_000);

  it("signup_started is recorded only for an identity WITHOUT an account, after the response", async () => {
    vi.resetModules();
    vi.stubEnv("FURLPAY_SESSION_SECRET", "s3cr3t-s3cr3t-s3cr3t-s3cr3t-s3cr3t");
    const writes: { event_name: string }[] = [];
    vi.doMock("@/lib/supabase", async (orig) => ({
      ...(await orig<typeof import("@/lib/supabase")>()),
      supabaseBackend: "supabase",
      sbInsertIgnoreDuplicates: vi.fn(async (_t: string, row: { event_name: string }) => void writes.push(row)),
    }));
    const tasks: (() => Promise<void>)[] = [];
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (t: () => Promise<void>) => tasks.push(t) }));
    const ev = await import("../events");
    ev.recordSignupStartedIfNew("new@example.com", "email", async () => false);
    ev.recordSignupStartedIfNew("known@example.com", "email", async () => true);
    ev.recordSignupStartedIfNew("unknown@example.com", "email", async () => {
      throw new Error("db down");
    });
    expect(writes).toHaveLength(0); // nothing on the request path
    await Promise.all(tasks.map((t) => t()));
    expect(writes.map((w) => w.event_name)).toEqual(["signup_started"]);
    expect(JSON.stringify(writes)).not.toContain("example.com");
    vi.unstubAllEnvs();
  });
});

describe("traffic classification", () => {
  const req = (path: string, method = "GET", headers: Record<string, string> = { "user-agent": "Mozilla/5.0 Chrome/131" }) =>
    new NextRequest(`http://localhost${path}`, { method, headers });

  it.each([
    ["/api/payments", "POST", "api"],
    ["/api/profile", "GET", "api"],
    ["/api/health", "GET", "excluded"],
    ["/api/cron/reconcile", "POST", "excluded"],
    ["/api/ops/analytics/dashboard", "GET", "excluded"],
    ["/api/payments", "OPTIONS", "excluded"],
    ["/dashboard", "GET", "page"],
    ["/dashboard", "HEAD", "excluded"],
    ["/analytics", "GET", "excluded"],
    ["/ops", "GET", "excluded"],
    ["/og.png", "GET", "excluded"],
    ["/_next/static/x.js", "GET", "excluded"],
  ])("%s %s → %s", (path, method, kind) => {
    expect(classifyRequest(req(path, method)).kind).toBe(kind);
  });

  it("bots, missing user agents and prefetches are not page views", () => {
    expect(classifyRequest(req("/", "GET", { "user-agent": "Googlebot/2.1" })).kind).toBe("excluded");
    expect(classifyRequest(req("/", "GET", {})).kind).toBe("excluded");
    expect(classifyRequest(req("/", "GET", { "user-agent": "Mozilla/5.0", "next-router-prefetch": "1" })).kind).toBe("excluded");
    expect(classifyRequest(req("/", "GET", { "user-agent": "Mozilla/5.0", "sec-purpose": "prefetch" })).kind).toBe("excluded");
  });

  it("error-rate numerator uses the same scope as the denominator", () => {
    expect(countsTowardApiErrorRate({ route: "/api/payments/[id]", routeType: "route" })).toBe(true);
    expect(countsTowardApiErrorRate({ route: "/api/health", routeType: "route" })).toBe(false);
    expect(countsTowardApiErrorRate({ route: "/api/ops/analytics/dashboard", routeType: "route" })).toBe(false);
    expect(countsTowardApiErrorRate({ route: "/dashboard", routeType: "render" })).toBe(false);
  });

  it("visitor ids are stable within a day, unlinkable across days, and never contain the IP", async () => {
    const a = await visitorId("203.0.113.7", "UA", "2026-10-01", "secret");
    const b = await visitorId("203.0.113.7", "UA", "2026-10-01", "secret");
    const c = await visitorId("203.0.113.7", "UA", "2026-10-02", "secret");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("203");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("route registry: no ops API can exist without an ADMIN_ONLY classification", () => {
  it("every route file under app/api/ops is registered ADMIN_ONLY in the security manifest", () => {
    const API = join(__dirname, "..", "..", "..", "app", "api");
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "security", "route-manifest.json"), "utf8"));
    const classes: Record<string, string> = manifest.routes ?? manifest.classifications ?? manifest;
    const found: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) {
          if (n !== "__tests__") walk(f);
        } else if (n === "route.ts") found.push(relative(API, d).split(sep).join("/"));
      }
    };
    walk(join(API, "ops"));
    expect(found.length).toBeGreaterThan(10);
    const flat = JSON.stringify(classes);
    const missing = found.filter((r) => !new RegExp(`"${r.replace(/[[\]]/g, "\\$&")}":\\s*"ADMIN_ONLY"`).test(flat));
    expect(missing).toEqual([]);
  });
});
