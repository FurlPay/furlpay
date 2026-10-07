import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Session revocation while the KV denylist is unavailable (audit 7 Oct 2026,
// P1-4). Before: the revocation write was swallowed and the durable read failed
// open, so a logged-out or stolen token kept full access on other instances.
// Now:
//   - an unreadable denylist is "unknown", never "clear";
//   - requireUser lets an unknown READ, but refuses any state change (503);
//   - logout that cannot reach the denylist falls back to the Postgres-backed
//     session epoch, so the logout holds on every instance.

const S = vi.hoisted(() => ({ kvDown: false, revoked: new Set<string>() }));

vi.mock("@/lib/kv", async (orig) => {
  const real = await orig<typeof import("@/lib/kv")>();
  return {
    ...real,
    kvGet: vi.fn(async (k: string) => {
      if (S.kvDown) throw new real.KvError("ERR max plan limit exceeded", "plan_limit", 400);
      return S.revoked.has(k) ? 1 : null;
    }),
    kvSet: vi.fn(async (k: string) => {
      if (S.kvDown) throw new real.KvError("ERR max plan limit exceeded", "plan_limit", 400);
      S.revoked.add(k);
    }),
  };
});

const bump = vi.hoisted(() => vi.fn(async () => 2));
vi.mock("@/lib/sessionEpoch", async (orig) => ({ ...(await orig<typeof import("@/lib/sessionEpoch")>()), bumpSessionEpoch: bump }));

import { revokeSession, signSession, verifySessionState, SESSION_COOKIE } from "@/lib/session";
import { requireUser } from "@/lib/authz";
import { POST as logout } from "@/app/api/auth/logout/route";

const req = (method: string, token: string) =>
  new NextRequest("http://localhost/api/account", { method, headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "192.0.2.10" } });

beforeEach(() => {
  S.kvDown = false;
  S.revoked.clear();
  bump.mockClear();
});

describe("verifySessionState", () => {
  it("is clear when the denylist is readable, and null once revoked", async () => {
    const t = await signSession({ sub: "u1", jti: "j1" });
    expect((await verifySessionState(t, { durable: true })).revocation).toBe("clear");
    expect(await revokeSession("j1")).toBe(true);
    expect((await verifySessionState(t, { durable: true })).claims).toBeNull();
  });

  it("reports unknown (not clear) when KV cannot be read", async () => {
    const t = await signSession({ sub: "u1", jti: "j2" });
    S.kvDown = true;
    const r = await verifySessionState(t, { durable: true });
    expect(r.claims?.sub).toBe("u1");
    expect(r.revocation).toBe("unknown");
  });

  it("revokeSession says when the revocation did not become durable", async () => {
    S.kvDown = true;
    expect(await revokeSession("j3")).toBe(false);
  });
});

describe("requireUser while revocation is unknown", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses %s with 503 session_check_unavailable", async (m) => {
    const t = await signSession({ sub: "u1", jti: "j4" });
    S.kvDown = true;
    const r = await requireUser(req(m, t));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(503);
      expect((await r.res.json()).error).toBe("session_check_unavailable");
    }
  });

  it("does not turn a GET into a 503 (reads stay available)", async () => {
    const t = await signSession({ sub: "u-missing", jti: "j5" });
    S.kvDown = true;
    const r = await requireUser(req("GET", t));
    // No such account in the test store, so the next check answers 401 — the
    // point is that the revocation check did not refuse the read.
    if (!r.ok) expect(r.res.status).not.toBe(503);
  });
});

describe("logout while KV is down", () => {
  it("falls back to bumping the durable session epoch", async () => {
    const t = await signSession({ sub: "u1", jti: "j6" });
    S.kvDown = true;
    const res = await logout(new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${t}`, "x-forwarded-for": "192.0.2.11" } }));
    expect(res.status).toBe(200);
    expect(bump).toHaveBeenCalledWith("u1");
  });

  it("does not bump the epoch when the denylist took the revocation", async () => {
    const t = await signSession({ sub: "u1", jti: "j7" });
    await logout(new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${t}`, "x-forwarded-for": "192.0.2.12" } }));
    expect(bump).not.toHaveBeenCalled();
    expect((await verifySessionState(t, { durable: true })).claims).toBeNull();
  });
});
