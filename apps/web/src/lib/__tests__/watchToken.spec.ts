import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

// SEC-P2-004: the watch gets a scoped credential, not the phone's full
// session. A stolen watch token is a read-only view of one account plus
// "freeze a card", and it dies with the phone's session.

const { POST: mintWatchToken } = await import("@/app/api/auth/watch-token/route");
const { POST: refresh } = await import("@/app/api/auth/refresh/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { requireUser } = await import("@/lib/authz");
const { signSession, verifySession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");
const { bumpSessionEpoch } = await import("@/lib/sessionEpoch");
const { isWatchFreezeOnly, watchAllows } = await import("@/lib/watchScope");

async function phone() {
  const { account } = findOrCreateUserByIdentity({ email: `watch-${randomUUID()}@furlpay.test`, name: "Watch" });
  const jti = randomUUID();
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user", "admin"], jti });
  return { userId: account.user.id, jti, token };
}

const req = (method: string, path: string, token: string, body?: unknown) =>
  new NextRequest(`https://furlpay.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-furlpay-client": "mobile-test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function watchToken(phoneToken: string) {
  const res = await mintWatchToken(req("POST", "/api/auth/watch-token", phoneToken));
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe("watch token (SEC-P2-004)", () => {
  it("is minted from a phone session: same session id, watch-scoped, never elevated", async () => {
    const p = await phone();
    const w = await watchToken(p.token);
    const claims = await verifySession(w, { allowWatch: true });
    expect(claims).toMatchObject({ sub: p.userId, jti: p.jti, watch: true, roles: ["user"] });
  });

  it("is invisible to every direct verifySession() caller (no exchange for a full session)", async () => {
    const w = await watchToken((await phone()).token);
    expect(await verifySession(w)).toBeNull();
    expect(await verifySession(w, { durable: true })).toBeNull();
  });

  it.each([
    ["GET", "/api/wallets"],
    ["GET", "/api/cards"],
    ["GET", "/api/transactions"],
    ["GET", "/api/markets/AAPL"],
  ])("may read %s %s", async (method, path) => {
    const w = await watchToken((await phone()).token);
    expect((await requireUser(req(method, path, w))).ok).toBe(true);
  });

  it.each([
    ["POST", "/api/payments/create"],
    ["POST", "/api/payments/execute"],
    ["POST", "/api/wallets/transfer"],
    ["POST", "/api/swaps/execute"],
    ["POST", "/api/investing/order"],
    ["POST", "/api/security/mfa"],
    ["DELETE", "/api/account"],
    ["GET", "/api/admin/users"],
    ["POST", "/api/auth/watch-token"],
    ["GET", "/api/markets/../admin"],
  ])("a stolen watch token is refused on %s %s", async (method, path) => {
    const w = await watchToken((await phone()).token);
    const auth = await requireUser(req(method, path, w));
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.res.status).toBe(403);
  });

  it("cannot refresh itself or mint another watch token", async () => {
    const w = await watchToken((await phone()).token);
    expect((await refresh(req("POST", "/api/auth/refresh", w))).status).toBe(403);
    expect((await mintWatchToken(req("POST", "/api/auth/watch-token", w))).status).toBe(403);
  });

  it("only a freeze passes the card-settings body check", () => {
    expect(watchAllows("POST", "/api/cards/settings")).toBe(true);
    expect(isWatchFreezeOnly({ cardId: "c1", freeze: true })).toBe(true);
    expect(isWatchFreezeOnly({ cardId: "c1", freeze: false })).toBe(false); // unfreeze
    expect(isWatchFreezeOnly({ cardId: "c1", freeze: true, limits: { daily: 1e6 } })).toBe(false);
    expect(isWatchFreezeOnly({ cardId: "c1", channels: { atm: true } })).toBe(false);
  });

  it("dies with the phone session: logout", async () => {
    const p = await phone();
    const w = await watchToken(p.token);
    expect((await logout(req("POST", "/api/auth/logout", p.token))).status).toBe(200);
    expect((await requireUser(req("GET", "/api/wallets", w))).ok).toBe(false);
  });

  it("dies with the phone session: log out everywhere / credential change (epoch)", async () => {
    const p = await phone();
    const w = await watchToken(p.token);
    await bumpSessionEpoch(p.userId);
    expect((await requireUser(req("GET", "/api/wallets", w))).ok).toBe(false);
  });

  it("an expired watch token is refused", async () => {
    const p = await phone();
    const secret = new TextEncoder().encode(process.env.FURLPAY_SESSION_SECRET ?? "furlpay_dev_session_secret_change_me_32bytes");
    const expired = await new SignJWT({ roles: ["user"], watch: true, sub: p.userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("furlpay")
      .setAudience("furlpay-app")
      .setJti(p.jti)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);
    expect((await requireUser(req("GET", "/api/wallets", expired))).ok).toBe(false);
  });

  it("is bound to its own account: it reads user A's data, never user B's", async () => {
    const a = await phone();
    await phone(); // user B exists
    const w = await watchToken(a.token);
    const auth = await requireUser(req("GET", "/api/cards", w));
    expect(auth.ok && auth.account.user.id).toBe(a.userId);
  });
});
