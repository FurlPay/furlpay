import { describe, expect, it, vi } from "vitest";
import { MAX_RANGE_DAYS, parseRange } from "../range";
import { kvListRange } from "@/lib/kv";
import { ERROR_LIST, recordActiveCountry, recordServerError } from "../telemetry";
import { pseudonym } from "../dashboard";
import { trustedClientCountry } from "@/lib/clientIp";

const NOW = Date.parse("2026-10-01T12:34:56Z");
const p = (qs: string) => parseRange(new URLSearchParams(qs), NOW);

describe("parseRange", () => {
  it("24h is 24 hourly buckets ending now", () => {
    const r = p("range=24h");
    if (!r.ok) throw new Error(r.error);
    expect(r.range.bucket).toBe("hour");
    expect(r.range.buckets).toHaveLength(24);
    expect(r.range.toMs).toBe(NOW + 1); // inclusive of now
    expect(r.range.prevToMs).toBe(r.range.fromMs);
  });

  it.each([["7d", 7], ["30d", 30], ["90d", 90]])("%s is %i UTC-day buckets", (key, n) => {
    const r = p(`range=${key}`);
    if (!r.ok) throw new Error(r.error);
    expect(r.range.buckets).toHaveLength(n);
    expect(new Date(r.range.fromMs).toISOString()).toMatch(/T00:00:00\.000Z$/);
  });

  it.each([
    "range=1y",
    "range=custom",
    "range=custom&from=2026-09-10&to=2026-09-01",
    "range=custom&from=2026-01-01&to=2026-09-01",
    "range=custom&from=2026-09-01&to=2026-12-01",
    "range=custom&from=nope&to=2026-09-01",
  ])("refuses %s", (qs) => {
    expect(p(qs).ok).toBe(false);
  });

  it(`custom ranges are inclusive and capped at ${MAX_RANGE_DAYS} days`, () => {
    const r = p("range=custom&from=2026-09-01&to=2026-09-30");
    if (!r.ok) throw new Error(r.error);
    expect(r.range.buckets).toHaveLength(30);
    expect(p("range=custom&from=2026-07-04&to=2026-10-01").ok).toBe(true); // exactly 90
    expect(p("range=custom&from=2026-07-03&to=2026-10-01").ok).toBe(false); // 91
  });
});

describe("telemetry never stores user input", () => {
  it("a server error keeps the route pattern and class name, never a message", async () => {
    await recordServerError({ route: "/api/payments/[id]", routeType: "route", method: "POST", error: "TypeError: bad input from alice@example.com" });
    const [latest] = await kvListRange(ERROR_LIST, 1);
    expect(latest).not.toContain("alice@example.com");
    expect(JSON.parse(latest)).toMatchObject({ route: "/api/payments/[id]", error: "Error", method: "POST" });
  });

  it("countries must be two letters; garbage is not recorded", () => {
    expect(recordActiveCountry("usr_x", "united states")).toBeNull();
    expect(recordActiveCountry("usr_x", "XX")).toBeNull();
    expect(recordActiveCountry("usr_x", null)).toBeNull();
  });

  it("one write per user, day and country per instance", () => {
    const id = `usr_${Math.random()}`;
    expect(recordActiveCountry(id, "IN")).not.toBeNull();
    expect(recordActiveCountry(id, "IN")).toBeNull();
  });
});

describe("trustedClientCountry", () => {
  const req = (c: string) => ({ headers: new Headers({ "x-vercel-ip-country": c }) });
  it("trusts the Vercel header only on Vercel", () => {
    expect(trustedClientCountry(req("in"), {})).toBe("IN");
    expect(trustedClientCountry(req("IN"), { FURLPAY_TRUSTED_PROXY_HOPS: "2" })).toBeNull();
    expect(trustedClientCountry(req("India"), {})).toBeNull();
  });
});

describe("pseudonym", () => {
  it("never returns the full id", () => {
    const id = "usr_8f3d2a9c-1b2e-4c5d-9e8f-0a1b2c3da2c1";
    const out = pseudonym(id);
    expect(out).toBe("usr_8f3d…a2c1");
    expect(out).not.toContain(id.slice(4));
    expect(pseudonym("short")).toBe("usr_…");
    expect(pseudonym(undefined)).toBe("—");
  });
});

describe("page gate maps auth outcomes", () => {
  it("401 → unauthenticated, 403/423 → forbidden, ok → admin", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
    const outcomes = [
      { ok: false, res: new Response(null, { status: 401 }) },
      { ok: false, res: new Response(null, { status: 403 }) },
      { ok: false, res: new Response(null, { status: 423 }) },
      { ok: true },
    ];
    let i = 0;
    vi.doMock("@/lib/ops/respond", () => ({ requireOpsAdmin: async () => outcomes[i++] }));
    const { adminPageAccess } = await import("../pageGate");
    expect(await adminPageAccess("/analytics")).toBe("unauthenticated");
    expect(await adminPageAccess("/analytics")).toBe("forbidden");
    expect(await adminPageAccess("/analytics")).toBe("forbidden");
    expect(await adminPageAccess("/analytics")).toBe("admin");
    vi.doUnmock("next/headers");
    vi.doUnmock("@/lib/ops/respond");
  });
});
