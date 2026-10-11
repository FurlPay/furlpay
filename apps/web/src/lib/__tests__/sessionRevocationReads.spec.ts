import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

// What a token may do while the KV revocation denylist cannot be read (audit
// 7 Oct 2026, P1-4). Complements sessionRevocationOutage.spec.ts (SEC-P2-002:
// durable logout via the session epoch, refresh keeps the jti):
//   - an unreadable denylist is "unknown", never "clear";
//   - requireUser lets an unknown READ, but refuses any state change (503);
//   - only /api/auth/refresh may opt in (a refreshed token keeps its jti, so it
//     stays revocable, and it still cannot write while unknown).

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

import { revokeSession, signSession, verifySessionState } from "@/lib/session";
import { requireUser } from "@/lib/authz";
import { findOrCreateUserByIdentity } from "@/lib/store";

const req = (method: string, token: string) =>
  new NextRequest("http://localhost/api/account", { method, headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "192.0.2.10" } });

async function session() {
  const { account } = findOrCreateUserByIdentity({ email: `rev-${randomUUID()}@furlpay.test` });
  return signSession({ sub: account.user.id, jti: randomUUID() });
}

beforeEach(() => {
  S.kvDown = false;
  S.revoked.clear();
});

describe("verifySessionState", () => {
  it("is clear when the denylist is readable, and null once revoked", async () => {
    const jti = randomUUID();
    const t = await signSession({ sub: "u1", jti });
    expect((await verifySessionState(t, { durable: true })).revocation).toBe("clear");
    expect(await revokeSession(jti)).toBe(true);
    expect((await verifySessionState(t, { durable: true })).claims).toBeNull();
  });

  it("reports unknown (not clear) when KV cannot be read", async () => {
    const t = await signSession({ sub: "u1", jti: randomUUID() });
    S.kvDown = true;
    const r = await verifySessionState(t, { durable: true });
    expect(r.claims?.sub).toBe("u1");
    expect(r.revocation).toBe("unknown");
  });

  it("revokeSession says when the revocation did not become durable", async () => {
    S.kvDown = true;
    expect(await revokeSession(randomUUID())).toBe(false);
  });
});

describe("requireUser while revocation is unknown", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses %s with 503 session_check_unavailable", async (m) => {
    const t = await session();
    S.kvDown = true;
    const r = await requireUser(req(m, t));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.res.status).toBe(503);
      expect((await r.res.json()).error).toBe("session_check_unavailable");
    }
  });

  it("lets a GET through: reads stay available", async () => {
    const t = await session();
    S.kvDown = true;
    expect((await requireUser(req("GET", t))).ok).toBe(true);
  });

  it("lets only an explicit opt-in (the refresh route) through on a write", async () => {
    const t = await session();
    S.kvDown = true;
    expect((await requireUser(req("POST", t), { allowUnknownRevocation: true })).ok).toBe(true);
    expect((await requireUser(req("POST", t))).ok).toBe(false);
  });

  it("is unaffected when KV is healthy", async () => {
    const t = await session();
    expect((await requireUser(req("POST", t))).ok).toBe(true);
  });
});
