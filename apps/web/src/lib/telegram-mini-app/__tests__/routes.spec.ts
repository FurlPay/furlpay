import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const m = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), nx: vi.fn(), auth: vi.fn(), getAccount: vi.fn(), sign: vi.fn(), cookie: vi.fn(), stepup: vi.fn(), consume: vi.fn(), deleted: vi.fn(), del: vi.fn(), limit: vi.fn(), kvBackend: "redis" }));
vi.mock("@/lib/supabase", () => ({ supabaseBackend: "supabase", sbSelect: m.select, sbInsert: m.insert, sbDelete: m.del }));
vi.mock("@/lib/kv", () => ({ get kvBackend() { return m.kvBackend; }, kvSetNx: m.nx }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: m.limit }));
vi.mock("@/lib/authz", () => ({ requireUser: m.auth }));
vi.mock("@/lib/store", () => ({ getAccountDurable: m.getAccount }));
vi.mock("@/lib/accountDeletion", () => ({ isAccountDeleted: m.deleted }));
vi.mock("@/lib/sessionEpoch", () => ({ currentEpoch: async () => 4 }));
vi.mock("@/lib/session", () => ({ signSession: m.sign, setSessionCookie: m.cookie, tokenFromRequest: (r: NextRequest) => r.cookies.get("furlpay_session")?.value }));
vi.mock("@/lib/stepup", () => ({ recentStepUp: m.stepup, consumeStepUp: m.consume }));
vi.mock("@/lib/cardIssuer", () => ({ cardIssuingLive: () => false }));
import { POST as login } from "@/app/api/auth/telegram/route";
import { POST as link, DELETE as unlink } from "@/app/api/miniapp/telegram-link/route";
import { GET as account } from "@/app/api/miniapp/account/route";

const token = "test-only:telegram-signing-key";
function payload(fieldsOverride: Record<string, string> = {}) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 111, first_name: "Synthetic" }), ...fieldsOverride });
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  fields.set("hash", createHmac("sha256", secret).update([...fields].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n")).digest("hex"));
  return fields.toString();
}
function request(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new NextRequest("https://furlpay.com/api/auth/telegram", { method: "POST", headers: { origin: "https://furlpay.com", "content-type": "application/json", ...headers }, body: JSON.stringify({ initData: payload(), ...extra }) });
}
const authorized = () => ({ ok: true, claims: { sub: "account-one", jti: "jti-one", auth_time: Math.floor(Date.now() / 1000) }, account: { user: { id: "account-one", name: "Test", kycStatus: "unverified", security: { accountLocked: false, totpSecret: "MUST-NOT-LEAK" } }, tokenBalances: [], transactions: [], cards: [{ id: "simulated", last4: "1234" }] } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TELEGRAM_BOT_TOKEN", token); vi.stubEnv("TELEGRAM_AUTH_MAX_AGE_SECONDS", "300"); vi.stubEnv("PUBLIC_API_ORIGIN", "https://furlpay.com");
  m.limit.mockResolvedValue(null); m.kvBackend = "redis";
  m.select.mockResolvedValue([{ user_id: "account-one" }]); m.insert.mockResolvedValue([]); m.nx.mockResolvedValue(true); m.auth.mockResolvedValue(authorized()); m.getAccount.mockResolvedValue(authorized().account); m.sign.mockResolvedValue("server-cookie-only"); m.stepup.mockResolvedValue(true); m.deleted.mockResolvedValue(false); m.del.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("Telegram session and linking boundaries", () => {
  it.each([429, 503])("honors the %i limiter response before reading or mutating identity state", async status => {
    m.limit.mockResolvedValue(NextResponse.json({ error: "blocked" }, { status }));
    expect((await login(request())).status).toBe(status);
    expect((await link(request())).status).toBe(status);
    expect((await unlink(new NextRequest("https://furlpay.com/api/miniapp/telegram-link", { method: "DELETE" }))).status).toBe(status);
    expect(m.limit).toHaveBeenCalledWith(expect.anything(), "auth.telegram", { limit: 10, windowMs: 60_000 });
    expect(m.limit).toHaveBeenCalledWith(expect.anything(), "miniapp.telegram-link", { limit: 5, windowMs: 600_000 }, "account-one");
    expect(m.select).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled(); expect(m.del).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it.each([{ user: { id: 111, first_name: "Spoofed" } }, { initDataUnsafe: { user: { id: 111 } } }])("refuses unsigned client identity fields %j", async extra => {
    expect((await login(request(extra))).status).toBe(400);
    expect((await link(request(extra))).status).toBe(400);
    expect(m.select).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it("rejects expired correctly signed data before looking up an account", async () => {
    const initData = payload({ auth_date: String(Math.floor(Date.now() / 1000) - 301) });
    expect((await login(request({ initData }))).status).toBe(401);
    expect((await link(request({ initData }))).status).toBe(401);
    expect(m.select).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it("refuses production identity issuance when the replay store is only memory", async () => {
    vi.stubEnv("NODE_ENV", "production"); m.kvBackend = "memory";
    expect((await login(request())).status).toBe(503);
    expect(m.select).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it("mints the existing session only for the verified linked account and never exposes its token", async () => {
    const res = await login(request()); expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "active", route: null });
    expect(m.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: "account-one", sepoch: 4, roles: ["user"] }));
    expect(m.cookie).toHaveBeenCalled(); expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects replay after logout instead of issuing another session", async () => {
    m.nx.mockResolvedValue(false); expect((await login(request())).status).toBe(401); expect(m.sign).not.toHaveBeenCalled();
  });
  it("does not merge a new Telegram identity by name or unverified profile", async () => {
    m.select.mockResolvedValue([]); const res = await login(request()); expect(await res.json()).toEqual({ status: "link_required", name: "Synthetic" }); expect(m.sign).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it("rejects login CSRF even before a session cookie exists", async () => {
    expect((await login(request({}, { origin: "https://evil.test" }))).status).toBe(403); expect(m.select).not.toHaveBeenCalled();
  });
  it("rejects client account ids and malformed init data", async () => {
    expect((await login(request({ userId: "victim" }))).status).toBe(400);
    expect((await login(request({ initData: "invalid" }))).status).toBe(401); expect(m.sign).not.toHaveBeenCalled();
  });
  it("fails closed for a missing secret or a persistence outage", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", ""); expect((await login(request())).status).toBe(503);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token); m.select.mockRejectedValue(new Error("database unavailable")); expect((await login(request())).status).toBe(503); expect(m.sign).not.toHaveBeenCalled();
  });
  it("does not switch another signed-in FurlPay account", async () => {
    m.auth.mockResolvedValue({ ...authorized(), account: { user: { id: "account-two" } } }); expect((await login(request({}, { cookie: "furlpay_session=existing" }))).status).toBe(409); expect(m.sign).not.toHaveBeenCalled();
  });
  it("rejects locked and deleted accounts", async () => {
    m.getAccount.mockResolvedValue({ user: { security: { accountLocked: true } } }); expect((await login(request())).status).toBe(403);
    m.getAccount.mockResolvedValue(authorized().account); m.deleted.mockResolvedValue(true); expect((await login(request())).status).toBe(403);
  });
  it("requires FurlPay authentication and a session-bound step-up to link", async () => {
    m.auth.mockResolvedValue({ ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }); expect((await link(request())).status).toBe(401);
    m.auth.mockResolvedValue(authorized()); m.stepup.mockResolvedValue(false); expect((await link(request())).status).toBe(403); expect(m.insert).not.toHaveBeenCalled();
  });
  it("does not overwrite another user's link or a concurrent unique-key winner", async () => {
    m.select.mockResolvedValue([{ user_id: "account-two" }]); expect((await link(request())).status).toBe(409); expect(m.insert).not.toHaveBeenCalled();
    m.select.mockResolvedValue([]); m.insert.mockRejectedValue({ status: 409 }); expect((await link(request())).status).toBe(409);
  });
  it("links only verified Telegram and session user ids, consuming step-up", async () => {
    m.select.mockResolvedValue([]); expect((await link(request())).status).toBe(200);
    expect(m.insert).toHaveBeenCalledWith("telegram_account_links", { telegram_id: 111, user_id: "account-one" }); expect(m.consume).toHaveBeenCalledWith("account-one", "jti-one");
  });
  it("a fresh auth_time alone does not authorize linking; guests never can", async () => {
    m.stepup.mockResolvedValue(false);
    m.auth.mockResolvedValue({ ...authorized(), claims: { ...authorized().claims, auth_time: Math.floor(Date.now() / 1000) } });
    expect((await link(request())).status).toBe(403);
    m.stepup.mockResolvedValue(true);
    m.auth.mockResolvedValue({ ...authorized(), claims: { ...authorized().claims, guest: true } });
    expect((await link(request())).status).toBe(403);
    expect(m.insert).not.toHaveBeenCalled();
  });
  it("unlinks only the signed-in account's own link, after step-up", async () => {
    const del = () => unlink(new NextRequest("https://furlpay.com/api/miniapp/telegram-link", { method: "DELETE", headers: { origin: "https://furlpay.com" } }));
    m.auth.mockResolvedValue({ ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await del()).status).toBe(401);
    m.auth.mockResolvedValue(authorized()); m.stepup.mockResolvedValue(false);
    expect((await del()).status).toBe(403); expect(m.del).not.toHaveBeenCalled();
    m.stepup.mockResolvedValue(true);
    const res = await del();
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ status: "unlinked" });
    expect(m.del).toHaveBeenCalledWith("telegram_account_links", "user_id=eq.account-one");
    expect(m.consume).toHaveBeenCalledWith("account-one", "jti-one");
  });
  it("an unlink storage failure is a 503, not a false success", async () => {
    m.del.mockRejectedValue(new Error("database unavailable"));
    expect((await unlink(new NextRequest("https://furlpay.com/api/miniapp/telegram-link", { method: "DELETE" }))).status).toBe(503);
  });
  it("reports whether this account is linked without returning the Telegram id, and null when unknown", async () => {
    m.select.mockResolvedValue([{ telegram_id: 111 }]);
    let body = await (await account(new NextRequest("https://furlpay.com/api/miniapp/account"))).json();
    expect(body.telegram).toEqual({ linked: true }); expect(JSON.stringify(body)).not.toContain("111");
    m.select.mockRejectedValue(new Error("table missing"));
    body = await (await account(new NextRequest("https://furlpay.com/api/miniapp/account"))).json();
    expect(body.telegram).toEqual({ linked: null });
  });
  it("returns only whitelisted account data and suppresses unavailable simulated cards", async () => {
    const res = await account(new NextRequest("https://furlpay.com/api/miniapp/account?userId=victim")); const body = await res.json();
    expect(body.cards).toEqual([]); expect(body.capabilities.transfers).toBe(false); expect(JSON.stringify(body)).not.toContain("MUST-NOT-LEAK"); expect(body.wallet.connectedAddress).toBeNull();
    m.auth.mockResolvedValue({ ok: false, res: NextResponse.json({}, { status: 401 }) }); expect((await account(new NextRequest("https://furlpay.com/api/miniapp/account"))).status).toBe(401);
  });
});
