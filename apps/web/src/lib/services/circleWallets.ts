import { createHash, randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Circle User-Controlled Wallets (W3S) — server side.
//
// Built against Circle's published OpenAPI (developers.circle.com/openapi/
// user-controlled-wallets.yaml, fetched 2026-10-02). Base https://api.circle.com,
// `Authorization: Bearer <API key>`, and — on every /user/* and wallet read —
// `X-User-Token`, a 60-minute per-user JWT minted server-side.
//
//   GET  /v1/w3s/users/{id}               user exists?            (404 → create)
//   POST /v1/w3s/users          {userId}  create user
//   POST /v1/w3s/users/token    {userId}  → { userToken, encryptionKey }
//   POST /v1/w3s/user/initialize          (X-User-Token) {idempotencyKey,
//                                         blockchains[], accountType?} → challengeId
//   GET  /v1/w3s/wallets                  (X-User-Token) → wallets
//   GET  /v1/w3s/wallets/{id}/balances    (X-User-Token) → tokenBalances
//   GET  /v1/w3s/user/challenges/{id}     (X-User-Token) → challenge status
//
// WHO HOLDS WHAT. The API key never leaves the server. The user token and
// encryption key go to the signed-in user's own device, because Circle's
// mobile/web SDK needs them to show its PIN/biometric UI and complete the
// challenge — the MPC key shares are Circle's and the user's, never FurlPay's.
//
// IDENTITY. Circle's userId is `fp_` + 40 hex of SHA-256(FurlPay user id):
// deterministic (the same FurlPay user always maps to the same Circle user),
// within Circle's 5–50 character limit, and it does not hand Circle our
// internal ids.
// ---------------------------------------------------------------------------

export class CircleWalletsNotConfigured extends Error {
  constructor() {
    super("Circle Wallets is not configured (CIRCLE_W3S_API_KEY / CIRCLE_W3S_APP_ID).");
    this.name = "CircleWalletsNotConfigured";
  }
}

export class CircleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string
  ) {
    super(message);
    this.name = "CircleApiError";
  }
}

/** Blockchains FurlPay offers for user-controlled wallets (Circle `Blockchain` enum values). */
export const CIRCLE_WALLET_CHAINS = [
  "ETH", "ARB", "BASE", "MATIC", "SOL", "AVAX", "OP",
  "ETH-SEPOLIA", "ARB-SEPOLIA", "BASE-SEPOLIA", "MATIC-AMOY", "SOL-DEVNET", "AVAX-FUJI", "OP-SEPOLIA",
] as const;
export type CircleWalletChain = (typeof CIRCLE_WALLET_CHAINS)[number];

/**
 * Circle API keys carry their environment as a prefix (`TEST_API_KEY:…` for the
 * sandbox, `LIVE_API_KEY:…` for mainnet), and a sandbox key can only create
 * testnet wallets. Read from the key itself, so the offer can't drift from it.
 */
export function circleEnvironment(): "testnet" | "mainnet" | null {
  const k = apiKey();
  if (k.startsWith("TEST_API_KEY:")) return "testnet";
  if (k.startsWith("LIVE_API_KEY:")) return "mainnet";
  return null;
}

const TESTNET = /-(SEPOLIA|AMOY|DEVNET|FUJI)$/;

/** The chains this deployment's key can create wallets on (all of them if the prefix is unrecognised). */
export function availableCircleChains(): CircleWalletChain[] {
  const env = circleEnvironment();
  if (env === null) return [...CIRCLE_WALLET_CHAINS];
  return CIRCLE_WALLET_CHAINS.filter((c) => TESTNET.test(c) === (env === "testnet"));
}

const apiKey = () => (process.env.CIRCLE_W3S_API_KEY ?? "").trim();
const apiBase = () => (process.env.CIRCLE_W3S_API_URL || "https://api.circle.com").replace(/\/+$/, "");
export const circleAppId = () => (process.env.CIRCLE_W3S_APP_ID ?? "").trim();

export function circleWalletsConfigured(): boolean {
  return apiKey().length > 0 && circleAppId().length > 0;
}

export function circleUserId(furlpayUserId: string): string {
  return `fp_${createHash("sha256").update(`furlpay:${furlpayUserId}`).digest("hex").slice(0, 40)}`;
}

type FetchImpl = typeof fetch;

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; userToken?: string; fetchImpl?: FetchImpl } = {}
): Promise<{ status: number; data: T | null }> {
  if (!circleWalletsConfigured()) throw new CircleWalletsNotConfigured();
  const res = await (opts.fetchImpl ?? fetch)(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
      "x-request-id": randomUUID(),
      ...(opts.userToken ? { "x-user-token": opts.userToken } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  let json: { data?: T; code?: number; message?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 404 && method === "GET") return { status: 404, data: null };
  if (!res.ok) {
    // Circle's error body is { code, message }. The message stays server-side.
    throw new CircleApiError(res.status, typeof json?.code === "number" ? json.code : null, json?.message ?? `HTTP ${res.status}`);
  }
  return { status: res.status, data: (json?.data ?? null) as T | null };
}

/** Make sure the Circle user exists. Idempotent. */
export async function ensureCircleUser(furlpayUserId: string, fetchImpl?: FetchImpl): Promise<string> {
  const id = circleUserId(furlpayUserId);
  const found = await call("GET", `/v1/w3s/users/${id}`, { fetchImpl });
  if (found.status === 404) await call("POST", "/v1/w3s/users", { body: { userId: id }, fetchImpl });
  return id;
}

export interface CircleUserSession {
  appId: string;
  userToken: string;
  encryptionKey: string;
}

/** A fresh 60-minute session for the SDK. */
export async function createUserSession(furlpayUserId: string, fetchImpl?: FetchImpl): Promise<CircleUserSession> {
  const id = await ensureCircleUser(furlpayUserId, fetchImpl);
  const { data } = await call<{ userToken?: string; encryptionKey?: string }>("POST", "/v1/w3s/users/token", {
    body: { userId: id },
    fetchImpl,
  });
  if (!data?.userToken || !data.encryptionKey) throw new CircleApiError(502, null, "token response missing fields");
  return { appId: circleAppId(), userToken: data.userToken, encryptionKey: data.encryptionKey };
}

/** Start PIN setup + wallet creation. The SDK completes the returned challenge on the device. */
export async function initializeUserWallets(
  userToken: string,
  blockchains: CircleWalletChain[],
  accountType: "SCA" | "EOA" | undefined,
  fetchImpl?: FetchImpl
): Promise<string> {
  const { data } = await call<{ challengeId?: string }>("POST", "/v1/w3s/user/initialize", {
    userToken,
    body: { idempotencyKey: randomUUID(), blockchains, ...(accountType ? { accountType } : {}) },
    fetchImpl,
  });
  if (!data?.challengeId) throw new CircleApiError(502, null, "initialize response missing challengeId");
  return data.challengeId;
}

export interface CircleWalletView {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  accountType: string | null;
}

export async function listUserWallets(userToken: string, fetchImpl?: FetchImpl): Promise<CircleWalletView[]> {
  const { data } = await call<{ wallets?: Record<string, unknown>[] }>("GET", "/v1/w3s/wallets", { userToken, fetchImpl });
  return (data?.wallets ?? [])
    .filter((w) => typeof w.id === "string" && typeof w.address === "string")
    .map((w) => ({
      id: w.id as string,
      address: w.address as string,
      blockchain: String(w.blockchain ?? ""),
      state: String(w.state ?? ""),
      accountType: typeof w.accountType === "string" ? w.accountType : null,
    }));
}

export interface CircleTokenBalance {
  /** Circle's token id — what a transfer names (`tokenId`). */
  tokenId: string | null;
  amount: string;
  symbol: string | null;
  blockchain: string | null;
}

export async function walletBalances(userToken: string, walletId: string, fetchImpl?: FetchImpl): Promise<CircleTokenBalance[]> {
  const { data } = await call<{
    tokenBalances?: { amount?: string; token?: { id?: string; symbol?: string; blockchain?: string } }[];
  }>("GET", `/v1/w3s/wallets/${encodeURIComponent(walletId)}/balances`, { userToken, fetchImpl });
  return (data?.tokenBalances ?? [])
    .filter((b) => typeof b.amount === "string")
    .map((b) => ({
      tokenId: b.token?.id ?? null,
      amount: b.amount as string,
      symbol: b.token?.symbol ?? null,
      blockchain: b.token?.blockchain ?? null,
    }));
}

/**
 * Create a TRANSFER challenge (POST /v1/w3s/user/transactions/transfer). This
 * moves nothing: the transfer happens only if the user approves the challenge
 * with their PIN/biometric in Circle's SDK. The caller supplies the
 * idempotency key so a retried request returns the same challenge (Circle
 * answers 200 with the existing one) instead of minting a second.
 */
export async function createTransferChallenge(
  userToken: string,
  req: { idempotencyKey: string; walletId: string; tokenId: string; destinationAddress: string; amount: string; refId?: string },
  fetchImpl?: FetchImpl
): Promise<string> {
  const { data } = await call<{ challengeId?: string }>("POST", "/v1/w3s/user/transactions/transfer", {
    userToken,
    body: {
      idempotencyKey: req.idempotencyKey,
      walletId: req.walletId,
      tokenId: req.tokenId,
      destinationAddress: req.destinationAddress,
      amounts: [req.amount],
      feeLevel: "MEDIUM",
      ...(req.refId ? { refId: req.refId } : {}),
    },
    fetchImpl,
  });
  if (!data?.challengeId) throw new CircleApiError(502, null, "transfer response missing challengeId");
  return data.challengeId;
}

/** Circle wallet blockchain → the chain names lib/compliance screening uses. */
export function screeningChainFor(blockchain: string): string | null {
  const base = blockchain.split("-")[0];
  const map: Record<string, string> = {
    ETH: "ethereum",
    ARB: "arbitrum",
    BASE: "base",
    MATIC: "polygon",
    SOL: "solana",
    AVAX: "avalanche",
    OP: "optimism",
  };
  return map[base] ?? null;
}

export interface CircleChallengeView {
  id: string;
  type: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED" | "EXPIRED" | string;
  correlationIds: string[];
  errorCode: number | null;
}

export async function getChallenge(userToken: string, challengeId: string, fetchImpl?: FetchImpl): Promise<CircleChallengeView | null> {
  const { status, data } = await call<{ challenge?: Record<string, unknown> }>(
    "GET",
    `/v1/w3s/user/challenges/${encodeURIComponent(challengeId)}`,
    { userToken, fetchImpl }
  );
  if (status === 404 || !data?.challenge) return null;
  const c = data.challenge;
  return {
    id: String(c.id ?? challengeId),
    type: String(c.type ?? ""),
    status: String(c.status ?? ""),
    correlationIds: Array.isArray(c.correlationIds) ? (c.correlationIds as string[]) : [],
    errorCode: typeof c.errorCode === "number" ? c.errorCode : null,
  };
}
