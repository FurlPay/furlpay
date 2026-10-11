import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// SEC-P2-002: a revoked session must stay revoked through a kv outage.
// Before the fix, refresh minted a NEW jti, and the durable revocation check
// fails open on kv errors, so a logged-out token could be refreshed into an
// unrevoked one that outlived the outage by up to 30 days.

const kvState = { down: false };
vi.mock("@/lib/kv", async (orig) => {
  const real = await orig<typeof import("@/lib/kv")>();
  const guard =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> =>
      kvState.down ? Promise.reject(new Error("kv unavailable")) : fn(...a);
  return { ...real, kvGet: guard(real.kvGet), kvSet: guard(real.kvSet) };
});

const { POST: refresh } = await import("@/app/api/auth/refresh/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { signSession, verifySession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");

/** Forget this instance's in-memory revocations: "the next request lands elsewhere". */
const otherInstance = () => (globalThis as unknown as { __revokedJtis?: Map<string, number> }).__revokedJtis?.clear();

async function session() {
  const { account } = findOrCreateUserByIdentity({ email: `rev-${randomUUID()}@furlpay.test`, name: "Rev" });
  const jti = randomUUID();
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti });
  return { userId: account.user.id, jti, token };
}

const call = (handler: (r: NextRequest) => Promise<Response>, path: string, token: string) =>
  handler(new NextRequest(`https://furlpay.com${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-furlpay-client": "mobile-test" } }));

async function refreshed(token: string) {
  const res = await call(refresh, "/api/auth/refresh", token);
  return { status: res.status, token: res.status === 200 ? ((await res.json()) as { token: string }).token : null };
}

afterEach(() => {
  kvState.down = false;
});

describe("session revocation survives kv outages (SEC-P2-002)", () => {
  it("refresh keeps the session's jti", async () => {
    const s = await session();
    const r = await refreshed(s.token);
    expect(r.status).toBe(200);
    expect((await verifySession(r.token!))?.jti).toBe(s.jti);
  });

  it("concurrent refreshes all stay in the same session", async () => {
    const s = await session();
    const results = await Promise.all(Array.from({ length: 10 }, () => refreshed(s.token)));
    const jtis = await Promise.all(results.map(async (r) => (await verifySession(r.token!))?.jti));
    expect(new Set(jtis)).toEqual(new Set([s.jti]));
  });

  it("after logout, neither the token nor anything refreshed from it works (kv up)", async () => {
    const s = await session();
    const child = (await refreshed(s.token)).token!;
    expect((await call(logout, "/api/auth/logout", s.token)).status).toBe(200);
    otherInstance();
    expect((await refreshed(s.token)).status).toBe(401);
    expect((await refreshed(child)).status).toBe(401);
  });

  it("a session revoked before an outage, refreshed during it, is dead once kv recovers", async () => {
    const s = await session();
    expect((await call(logout, "/api/auth/logout", s.token)).status).toBe(200); // durable revocation recorded
    otherInstance();
    kvState.down = true; // revocation check now fails open
    const during = await refreshed(s.token);
    kvState.down = false;
    otherInstance();
    // Whatever the outage handed out carries the revoked jti, so it is refused.
    if (during.token) expect((await refreshed(during.token)).status).toBe(401);
    expect((await refreshed(s.token)).status).toBe(401);
  });

  it("a logout DURING an outage falls back to the account epoch and ends the session everywhere", async () => {
    const s = await session();
    kvState.down = true;
    expect((await call(logout, "/api/auth/logout", s.token)).status).toBe(200);
    otherInstance();
    // Even with kv still down, the epoch (account store) refuses the token.
    expect((await refreshed(s.token)).status).toBe(401);
    kvState.down = false;
    expect((await refreshed(s.token)).status).toBe(401);
  });

  it("a session that was never revoked keeps refreshing through an outage", async () => {
    const s = await session();
    kvState.down = true;
    expect((await refreshed(s.token)).status).toBe(200);
  });
});
