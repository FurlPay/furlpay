import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { signSession } from "@/lib/session";

// POST /api/analytics/events[/batch] through the real auth path. Storage is a
// recording fake of the Supabase insert (the SQL side is proven on PostgreSQL
// by scripts/db/verify-analytics.mjs); everything else is real.

const inserts: Record<string, unknown>[][] = [];
const owned = new Set<string>(); // "txid|userId"
const storage = { fail: false };

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbInsertIgnoreDuplicates: vi.fn(async (_t: string, rows: Record<string, unknown>[]) => {
    if (storage.fail) throw new Error("ECONNREFUSED");
    inserts.push(rows);
  }),
  sbRpc: vi.fn(async () => true),
  sbCount: vi.fn(async (_t: string, q: string) => {
    const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(q)?.[1] ?? "");
    const user = decodeURIComponent(/user_id=eq\.([^&]+)/.exec(q)?.[1] ?? "");
    return owned.has(`${id}|${user}`) ? 1 : 0;
  }),
}));

const { POST: single } = await import("../route");
const { POST: batch } = await import("../batch/route");

const ev = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  eventId: `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
  eventName: "screen_viewed",
  platform: "android",
  timestamp: new Date().toISOString(),
  appVersion: "2.3.0",
  buildNumber: "7",
  screen: "Wallet",
  installationId: randomUUID(),
  ...over,
});

let ip = 0;
const req = (path: string, body: unknown, token?: string) =>
  new NextRequest(`http://localhost/api/analytics/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // A fresh client address per request so per-IP budgets do not couple tests.
      "x-real-ip": `198.51.100.${(ip++ % 250) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

async function userToken() {
  const { account } = findOrCreateUserByIdentity({ email: `ingest-${randomUUID()}@example.com` });
  return { id: account.user.id, token: await signSession({ sub: account.user.id, safe: "0x0", jti: randomUUID() }) };
}

beforeEach(() => {
  inserts.length = 0;
  storage.fail = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("identity is the session, never the payload", () => {
  it("a signed-in event is stored under the SESSION user", async () => {
    const a = await userToken();
    const res = await single(req("events", ev(), a.token));
    expect(res.status).toBe(202);
    const row = inserts.flat()[0];
    expect(row.user_id).toBe(a.id);
    expect(row.actor_type).toBe("user");
    expect(row.source).toBe("client");
  });

  it("user A claiming to be user B is REJECTED, not reattributed", async () => {
    const a = await userToken();
    const b = await userToken();
    for (const claim of [
      { userId: b.id },
      { user_id: b.id },
      { metadata: { userId: b.id } },
      // spelling and case do not get a claim through
      { UserId: b.id },
      { "user-id": b.id },
      { EMAIL: "b@example.com" },
      { metadata: { Account_Id: b.id } },
    ]) {
      const res = await single(req("events", ev(claim), a.token));
      const body = (await res.json()) as { accepted: number; rejected: { reason: string }[] };
      expect(body.accepted).toBe(0);
      expect(body.rejected[0].reason).toBe("identity_claim");
    }
    expect(inserts.flat().some((r) => r.user_id === b.id)).toBe(false);
  });

  it("anonymous events carry no user and keep only the random anonymous id", async () => {
    const anonId = randomUUID();
    const res = await single(req("events", ev({ platform: "web", eventName: "page_viewed", anonId, route: "/pricing?ref=abc&token=SECRET" })));
    expect(res.status).toBe(202);
    const row = inserts.flat()[0];
    expect(row.user_id).toBeNull();
    expect(row.actor_type).toBe("anonymous");
    expect(row.anon_id).toBe(anonId);
    expect(row.route).toBe("/pricing"); // query string (and any token in it) never stored
  });

  it("a revoked / garbage credential is refused, never downgraded to anonymous", async () => {
    const res = await single(req("events", ev(), "not-a-real-token"));
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });
});

describe("the contract is closed", () => {
  it.each(["payment_completed", "transaction_settled", "kyc_completed", "cashback_claimed", "deposit_completed", "card_payment_settled"])(
    "client cannot report the authoritative fact %s",
    async (eventName) => {
      const a = await userToken();
      const body = (await (await single(req("events", ev({ eventName }), a.token))).json()) as { rejected: { reason: string }[] };
      expect(body.rejected[0].reason).toBe("server_only_event");
    }
  );

  it.each([
    [{ eventName: "made_up_event" }, "unknown_event"],
    [{ platform: "windows_phone" }, "bad_platform"],
    [{ platform: "api" }, "bad_platform"], // the server's own platform is not client-claimable
    [{ timestamp: "yesterday" }, "bad_timestamp"],
    [{ timestamp: new Date(Date.now() - 8 * 86_400_000).toISOString() }, "too_old"],
    [{ timestamp: new Date(Date.now() + 3_600_000).toISOString() }, "in_future"],
    [{ appVersion: "1.0; DROP TABLE" }, "bad_version"],
    [{ screen: "<script>alert(1)</script>" }, "bad_screen"],
    [{ installationId: "imei-356938035643809" }, "bad_id"],
    [{ schemaVersion: 99 }, "unsupported_schema"],
  ])("%j → %s", async (over, reason) => {
    const body = (await (await single(req("events", ev(over)))).json()) as { rejected: { reason: string }[] };
    expect(body.rejected[0]?.reason).toBe(reason);
  });

  it("metadata is filtered to allowlisted primitive keys", async () => {
    await single(req("events", ev({ metadata: { outcome: "success", seedPhrase: "abandon …", nested: { a: 1 }, cookie: "x", chain: "solana" } })));
    expect(inserts.flat()[0].metadata).toEqual({ outcome: "success", chain: "solana" });
  });

  it("personal data is dropped even under an allowlisted key", async () => {
    await single(
      req("events", ev({
        metadata: {
          outcome: "success",
          reason: "sent to alice@example.com",
          destinationType: "0x52908400098527886E0F7030069857D2E4169EE7",
          provider: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Solana address
          errorCode: "card 4111111111111111",
          chain: "arbitrum",
        },
        route: "/u/alice@example.com/pay",
      }))
    );
    const row = inserts.flat()[0];
    expect(row.metadata).toEqual({ outcome: "success", chain: "arbitrum" });
    expect(row.route).toBe("/u/:id/pay");
  });
});

describe("idempotency and ownership", () => {
  it("the same client event id sent 10 times maps to ONE stored event id", async () => {
    const a = await userToken();
    const e = ev();
    for (let i = 0; i < 10; i++) await single(req("events", e, a.token));
    expect(new Set(inserts.flat().map((r) => r.event_id)).size).toBe(1);
  });

  it("another identity reusing that event id cannot suppress it (ids are namespaced)", async () => {
    const a = await userToken();
    const b = await userToken();
    const e = ev();
    await single(req("events", e, a.token));
    await single(req("events", e, b.token));
    expect(new Set(inserts.flat().map((r) => r.event_id)).size).toBe(2);
  });

  it("a transaction id is kept only for its owner", async () => {
    const a = await userToken();
    const b = await userToken();
    owned.add(`tx_owned_by_a|${a.id}`);
    const okRes = (await (await single(req("events", ev({ eventName: "transaction_viewed", transactionId: "tx_owned_by_a" }), a.token))).json()) as { accepted: number };
    expect(okRes.accepted).toBe(1);
    const theft = (await (await single(req("events", ev({ eventName: "transaction_viewed", transactionId: "tx_owned_by_a" }), b.token))).json()) as { rejected: { reason: string }[] };
    expect(theft.rejected[0].reason).toBe("transaction_not_owned");
    const anon = (await (await single(req("events", ev({ eventName: "transaction_viewed", transactionId: "tx_owned_by_a" })))).json()) as { rejected: { reason: string }[] };
    expect(anon.rejected[0].reason).toBe("anonymous_transaction");
  });
});

describe("batch bounds, rate limits, failure", () => {
  it("accepts up to 50 events; refuses 51 and oversized bodies", async () => {
    const a = await userToken();
    const okRes = await batch(req("events/batch", { events: Array.from({ length: 50 }, () => ev()) }, a.token));
    expect(okRes.status).toBe(202);
    expect(((await okRes.json()) as { accepted: number }).accepted).toBe(50);
    expect((await batch(req("events/batch", { events: Array.from({ length: 51 }, () => ev()) }, a.token))).status).toBe(400);
    const huge = { events: [ev({ metadata: { reason: "x".repeat(70_000) } })] };
    expect([400, 413]).toContain((await batch(req("events/batch", huge, a.token))).status);
    expect((await batch(req("events/batch", { events: [], extra: 1 }, a.token))).status).toBe(400);
  });

  it("an anonymous flood from one address is rate limited", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const r = new NextRequest("http://localhost/api/analytics/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.99" },
        body: JSON.stringify(ev({ platform: "web", eventName: "page_viewed" })),
      });
      statuses.push((await single(r)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("a header that is not a credential does not buy the signed-in budget", async () => {
    // `Authorization: Basic …` is not a session (tokenFromRequest ignores it),
    // so the request is anonymous and must get the anonymous budget too.
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const r = new NextRequest("http://localhost/api/analytics/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.98", authorization: "Basic eDp5" },
        body: JSON.stringify(ev({ platform: "web", eventName: "page_viewed" })),
      });
      statuses.push((await single(r)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("analytics storage down → 503 for the client to retry; never a fake 2xx", async () => {
    storage.fail = true;
    const res = await single(req("events", ev()));
    expect(res.status).toBe(503);
  });

  it("kill switch answers 503 disabled and stores nothing", async () => {
    vi.stubEnv("FURLPAY_ANALYTICS_INGEST", "off");
    const res = await single(req("events", ev()));
    expect(res.status).toBe(503);
    expect(inserts).toHaveLength(0);
  });
});
