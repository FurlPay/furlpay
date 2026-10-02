import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmlScreenResult } from "@furlpay/compliance";

// Circle user-controlled wallets — service request shapes (pinned to Circle's
// user-controlled-wallets OpenAPI) and the /api/wallets/circle* route policy.

const H = vi.hoisted(() => ({
  authed: true,
  kycTier: 2 as number,
  screen: { action: "allow" } as Partial<AmlScreenResult>,
  audits: [] as { event: string; fields: Record<string, unknown> }[],
}));

vi.mock("@/lib/authz", () => ({
  requireUser: vi.fn(async () =>
    H.authed
      ? { ok: true, claims: { sub: "user-1" }, account: { user: { id: "user-1", kycTier: H.kycTier } } }
      : { ok: false, res: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) }
  ),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({
  audit: (event: string, _actor: string, fields: Record<string, unknown>) => H.audits.push({ event, fields }),
}));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn(async () => H.screen) }));

import { circleUserId, createUserSession, createTransferChallenge } from "@/lib/services/circleWallets";
import { GET as walletsGet, POST as walletsPost } from "@/app/api/wallets/circle/route";
import { GET as challengeGet } from "@/app/api/wallets/circle/challenge/route";
import { POST as transferPost } from "@/app/api/wallets/circle/transfer/route";
import { POST as rainRewardsWebhook } from "@/app/api/webhooks/rain-rewards/route";

const WALLET_ID = "0b1e8c2a-3f4d-4e5a-9b6c-7d8e9f0a1b2c";
const TOKEN_ID = "36b6931a-873a-56a8-8a27-b706b17104ee";
const SRC = "0x" + "11".repeat(20);
const DEST = "0x" + "22".repeat(20);
const CHALLENGE = "c4d1da72-111e-4d52-bdbf-2e74a2d803d5";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let userExists: boolean;
let usdcBalance: string;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function circleFake(url: string, init: RequestInit): Response {
  const path = new URL(url).pathname;
  const method = init.method ?? "GET";
  calls.push({ url, method, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined });
  if (method === "GET" && path.startsWith("/v1/w3s/users/")) return userExists ? json(200, { data: { user: {} } }) : json(404, { code: 156001, message: "not found" });
  if (method === "POST" && path === "/v1/w3s/users") return json(201, { data: {} });
  if (method === "POST" && path === "/v1/w3s/users/token") return json(200, { data: { userToken: "UT", encryptionKey: "EK" } });
  if (method === "POST" && path === "/v1/w3s/user/initialize") return json(201, { data: { challengeId: CHALLENGE } });
  if (method === "GET" && path === "/v1/w3s/wallets")
    return json(200, { data: { wallets: [{ id: WALLET_ID, address: SRC, blockchain: "ARB", state: "LIVE", accountType: "SCA" }] } });
  if (method === "GET" && path === `/v1/w3s/wallets/${WALLET_ID}/balances`)
    return json(200, { data: { tokenBalances: [{ amount: usdcBalance, token: { id: TOKEN_ID, symbol: "USDC", blockchain: "ARB" } }] } });
  if (method === "GET" && path === `/v1/w3s/user/challenges/${CHALLENGE}`)
    return json(200, { data: { challenge: { id: CHALLENGE, type: "INITIALIZE", status: "COMPLETE", correlationIds: [] } } });
  if (method === "GET" && path.startsWith("/v1/w3s/user/challenges/")) return json(404, { code: 155001, message: "not found" });
  if (method === "POST" && path === "/v1/w3s/user/transactions/transfer") return json(201, { data: { challengeId: CHALLENGE } });
  return json(500, { message: `unmocked ${method} ${path}` });
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) as never;
const get = (path: string) => {
  const r = new Request(`http://localhost${path}`) as Request & { nextUrl: URL };
  r.nextUrl = new URL(r.url);
  return r as never;
};

beforeEach(() => {
  process.env.CIRCLE_W3S_API_KEY = "TEST_API_KEY:id:secret";
  process.env.CIRCLE_W3S_APP_ID = "app-123";
  H.authed = true;
  H.kycTier = 2;
  H.screen = { action: "allow" };
  H.audits = [];
  calls = [];
  userExists = true;
  usdcBalance = "500";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => circleFake(url, init)));
});
afterEach(() => {
  delete process.env.CIRCLE_W3S_API_KEY;
  delete process.env.CIRCLE_W3S_APP_ID;
  vi.unstubAllGlobals();
});

describe("circleWallets service", () => {
  it("circleUserId is deterministic, prefixed, within Circle's 5–50 chars, and hides the internal id", () => {
    const id = circleUserId("user-1");
    expect(id).toBe(circleUserId("user-1"));
    expect(id).toMatch(/^fp_[0-9a-f]{40}$/);
    expect(id.length).toBeLessThanOrEqual(50);
    expect(id).not.toContain("user-1");
  });
  it("creates the Circle user on 404, then mints a token; API key only in Authorization", async () => {
    userExists = false;
    const s = await createUserSession("user-1");
    expect(s).toEqual({ appId: "app-123", userToken: "UT", encryptionKey: "EK" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v1/w3s/users/${circleUserId("user-1")}`,
      "POST /v1/w3s/users",
      "POST /v1/w3s/users/token",
    ]);
    expect(calls[1].body).toEqual({ userId: circleUserId("user-1") });
    for (const c of calls) expect(c.headers.authorization).toBe("Bearer TEST_API_KEY:id:secret");
  });
  it("transfer challenge sends the spec body with X-User-Token", async () => {
    await createTransferChallenge("UT", {
      idempotencyKey: "9f1c0f7e-1111-4222-8333-944455556666",
      walletId: WALLET_ID,
      tokenId: TOKEN_ID,
      destinationAddress: DEST,
      amount: "12.5",
    });
    expect(calls[0].headers["x-user-token"]).toBe("UT");
    expect(calls[0].body).toMatchObject({
      idempotencyKey: "9f1c0f7e-1111-4222-8333-944455556666",
      walletId: WALLET_ID,
      tokenId: TOKEN_ID,
      destinationAddress: DEST,
      amounts: ["12.5"],
      feeLevel: "MEDIUM",
    });
  });
});

describe("/api/wallets/circle*", () => {
  it.each([
    ["GET wallets", () => walletsGet(get("/api/wallets/circle"))],
    ["POST wallets", () => walletsPost(post("/api/wallets/circle", { blockchains: ["ARB"] }))],
    ["GET challenge", () => challengeGet(get(`/api/wallets/circle/challenge?id=${CHALLENGE}`))],
  ])("%s: 401 without a session, 503 when unconfigured", async (_n, call) => {
    H.authed = false;
    expect((await call()).status).toBe(401);
    H.authed = true;
    delete process.env.CIRCLE_W3S_APP_ID;
    expect((await call()).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("POST initializes and returns the SDK session + challengeId", async () => {
    const res = await walletsPost(post("/api/wallets/circle", { blockchains: ["ARB-SEPOLIA", "BASE-SEPOLIA"], accountType: "SCA" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ challengeId: CHALLENGE, appId: "app-123", userToken: "UT", encryptionKey: "EK" });
    const init = calls.find((c) => c.url.endsWith("/v1/w3s/user/initialize"))!;
    expect(init.headers["x-user-token"]).toBe("UT");
    expect(init.body).toMatchObject({ blockchains: ["ARB-SEPOLIA", "BASE-SEPOLIA"], accountType: "SCA" });
    expect(H.audits.map((a) => a.event)).toEqual(["circle.user_initialized"]);
  });
  it("POST refuses a network the key cannot serve (TEST key → mainnet ARB), before calling Circle", async () => {
    const res = await walletsPost(post("/api/wallets/circle", { blockchains: ["ARB"] }));
    expect(res.status).toBe(400);
    expect((await res.json()).chains).toContain("ARB-SEPOLIA");
    expect(calls).toHaveLength(0);
  });
  it("GET offers only the key's networks", async () => {
    const body = await (await walletsGet(get("/api/wallets/circle"))).json();
    expect(body.environment).toBe("testnet");
    expect(body.chains).toEqual(["ETH-SEPOLIA", "ARB-SEPOLIA", "BASE-SEPOLIA", "MATIC-AMOY", "SOL-DEVNET", "AVAX-FUJI", "OP-SEPOLIA"]);
  });
  it("POST rejects an unknown blockchain (Zod)", async () => {
    expect((await walletsPost(post("/api/wallets/circle", { blockchains: ["DOGE"] }))).status).toBe(400);
  });
  it("GET lists wallets with balances", async () => {
    const body = await (await walletsGet(get("/api/wallets/circle"))).json();
    expect(body.wallets[0]).toMatchObject({ id: WALLET_ID, address: SRC, balances: [{ symbol: "USDC", amount: "500", tokenId: TOKEN_ID }] });
  });
  it("challenge: reads Circle's real status; unknown id → 404; malformed id → 400", async () => {
    const ok = await challengeGet(get(`/api/wallets/circle/challenge?id=${CHALLENGE}`));
    expect((await ok.json()).challenge.status).toBe("COMPLETE");
    expect((await challengeGet(get(`/api/wallets/circle/challenge?id=${WALLET_ID}`))).status).toBe(404);
    expect((await challengeGet(get("/api/wallets/circle/challenge?id=nope"))).status).toBe(400);
  });
});

describe("POST /api/wallets/circle/transfer", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    idempotencyKey: "9f1c0f7e-1111-4222-8333-944455556666",
    walletId: WALLET_ID,
    destinationAddress: DEST,
    amount: "100",
    ...over,
  });
  const transfers = () => calls.filter((c) => c.url.endsWith("/v1/w3s/user/transactions/transfer"));

  it("creates a challenge only after every gate passes", async () => {
    const res = await transferPost(post("/api/wallets/circle/transfer", body()));
    expect(res.status).toBe(201);
    expect((await res.json()).challengeId).toBe(CHALLENGE);
    expect(transfers()[0].body).toMatchObject({ tokenId: TOKEN_ID, amounts: ["100"], walletId: WALLET_ID });
    expect(H.audits.map((a) => a.event)).toEqual(["circle.transfer_challenge_created"]);
  });
  it.each([
    ["AML block → 403", () => (H.screen = { action: "block" }), 403],
    ["AML review → 409", () => (H.screen = { action: "review" }), 409],
    ["insufficient USDC → 409", () => (usdcBalance = "50"), 409],
    ["KYC tier 0 over cap → 403", () => (H.kycTier = 0), 403],
  ])("%s, and no challenge is created", async (_n, arrange, status) => {
    arrange();
    const res = await transferPost(post("/api/wallets/circle/transfer", body(_n.startsWith("KYC") ? { amount: "999999" } : {})));
    expect(res.status).toBe(status);
    expect(transfers()).toHaveLength(0);
  });
  it.each([
    ["wallet not owned", { walletId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, 404],
    ["non-EVM destination on ARB", { destinationAddress: "So11111111111111111111111111111111111111112" }, 400],
    ["self-transfer", { destinationAddress: SRC }, 400],
    ["zero amount", { amount: "0" }, 400],
    ["7 decimals", { amount: "1.0000001" }, 400],
    ["over 1,000,000", { amount: "1000001" }, 400],
  ])("%s → %s", async (_n, over, status) => {
    expect((await transferPost(post("/api/wallets/circle/transfer", body(over)))).status).toBe(status);
    expect(transfers()).toHaveLength(0);
  });
});

describe("POST /api/webhooks/rain-rewards", () => {
  it("refuses with 501 until Rain's signature scheme is known", async () => {
    const res = await rainRewardsWebhook(post("/api/webhooks/rain-rewards", { type: "rewards.earned" }));
    expect(res.status).toBe(501);
  });
});
