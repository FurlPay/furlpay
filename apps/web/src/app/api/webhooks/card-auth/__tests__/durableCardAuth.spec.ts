import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Route-level proof that /api/webhooks/card-auth approves (and books spend for)
// one authorization at most once.
//
// Runs the REAL route + REAL withDurableWebhook + REAL lib/webhookEvents. The
// Postgres RPCs are an in-memory double mirroring migration 0022's SQL (UNIQUE
// claim, failed/stale reclaim, same-hash-only reclaim). The KV guard is
// switchable. The financial effect counted is the approved card transaction and
// the card's dailySpent increment.
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => {
  type Row = { status: string; hash: string; startedAt: number };
  return {
    backend: "supabase" as string,
    dbDown: false,
    now: 1_000_000_000_000,
    rows: new Map<string, Row>(),
    kvMode: "working" as "working" | "open" | "throw",
    kv: new Map<string, string>(),
    settled: [] as unknown[],
    card: { id: "card_1", label: "Everyday", network: "visa", limits: { dailySpent: 0 } },
  };
});
const STALE_MS = 15 * 60_000;

vi.mock("@/lib/supabase", () => ({
  get supabaseBackend() {
    return S.backend;
  },
  sbRpc: vi.fn(async (fn: string, a: Record<string, string>) => {
    if (S.dbDown) throw new Error("connect ECONNREFUSED");
    const key = `${a.p_provider}|${a.p_provider_event_id}`;
    const row = S.rows.get(key);
    if (fn === "claim_webhook_event") {
      if (!row) {
        S.rows.set(key, { status: "processing", hash: a.p_payload_hash, startedAt: S.now });
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      const reclaimable =
        (row.status === "failed" || (row.status === "processing" && row.startedAt < S.now - STALE_MS)) &&
        row.hash === a.p_payload_hash;
      if (reclaimable) {
        row.status = "processing";
        row.startedAt = S.now;
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      return [{ claimed: false, duplicate: true, existing_status: row.status, payload_mismatch: row.hash !== a.p_payload_hash }];
    }
    if (fn === "mark_webhook_processed" && row) row.status = "processed";
    if (fn === "mark_webhook_failed" && row) row.status = "failed";
    return undefined;
  }),
}));

vi.mock("@/lib/kv", () => ({
  kvSetNx: vi.fn(async (k: string, v: string) => {
    if (S.kvMode === "throw") throw new Error("upstash unavailable");
    if (S.kvMode === "open") return true;
    if (S.kv.has(k)) return false;
    S.kv.set(k, v);
    return true;
  }),
  kvSet: vi.fn(async (k: string, v: string) => {
    if (S.kvMode === "working") S.kv.set(k, v);
  }),
  kvDel: vi.fn(async (k: string) => {
    if (S.kvMode === "working") S.kv.delete(k);
  }),
}));

vi.mock("@furlpay/compliance", () => ({
  constructEvent: (body: string, sig: string | null) => {
    if (sig !== "valid-signature") throw new Error("signature verification failed");
    return JSON.parse(body);
  },
}));

vi.mock("@/lib/store", () => ({
  findAccountByCard: vi.fn(async () => ({
    account: {
      user: { id: "user_1" },
      transactions: [],
      fiatBalances: [{ usdValue: 1_000 }],
    },
    card: S.card,
  })),
  newTx: (t: unknown) => t,
  recordTransaction: vi.fn((_: string, tx: { status: string }) => {
    if (tx.status === "settled") S.settled.push(tx);
  }),
}));
vi.mock("@/lib/services/policyEngine", () => ({ evaluateSpend: () => ({ approved: true, reasons: [] }) }));
vi.mock("@/lib/services/cardAuthChallenges", () => ({ createChallenge: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(async () => 0) }));
vi.mock("@/lib/webhookGuard", () => ({ endpointSecret: () => "whsec_test_real_value" }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { audit } from "@/lib/audit";
import { recordTransaction } from "@/lib/store";

function authBody(id: string, amountUsd = 12): string {
  return JSON.stringify({ id, type: "authorization.request", data: { amountUsd, cardId: "card_1", merchant: "Coffee" } });
}

function deliver(body: string, signature = "valid-signature") {
  return POST(
    new NextRequest("http://localhost/api/webhooks/card-auth", {
      method: "POST",
      body,
      headers: { "furlpay-signature": signature },
    })
  );
}

beforeEach(() => {
  S.backend = "supabase";
  S.dbDown = false;
  S.now = 1_000_000_000_000;
  S.rows.clear();
  S.kvMode = "working";
  S.kv.clear();
  S.settled.length = 0;
  S.card.limits.dailySpent = 0;
  vi.mocked(audit).mockClear();
  vi.mocked(recordTransaction).mockClear();
});

describe("card-auth webhook — durable dedupe at the route", () => {
  it("first delivery: approved once, spend booked once, row processed", async () => {
    const res = await deliver(authBody("iauth_1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ approved: true });
    expect(S.settled).toHaveLength(1);
    expect(S.card.limits.dailySpent).toBe(12);
    expect(S.rows.get("card-auth|iauth_1")?.status).toBe("processed");
  });

  it("sequential duplicate: no second approval or spend", async () => {
    await deliver(authBody("iauth_1"));
    const dup = await deliver(authBody("iauth_1"));
    expect(await dup.json()).toMatchObject({ deduped: true });
    expect(S.settled).toHaveLength(1);
    expect(S.card.limits.dailySpent).toBe(12);
  });

  it("50 concurrent deliveries with KV OPEN: exactly one approval, spend booked once", async () => {
    S.kvMode = "open";
    const body = authBody("iauth_race");
    const res = await Promise.all(Array.from({ length: 50 }, () => deliver(body)));
    const approvals = (await Promise.all(res.map((r) => r.json()))).filter((j) => j.approved === true);
    expect(approvals).toHaveLength(1);
    expect(S.settled).toHaveLength(1);
    expect(S.card.limits.dailySpent).toBe(12);
    expect(S.rows.size).toBe(1);
  });

  it("same authorization id, different amount: 400, nothing booked, audited", async () => {
    await deliver(authBody("iauth_1", 12));
    const res = await deliver(authBody("iauth_1", 9_000));
    expect(res.status).toBe(400);
    expect(S.settled).toHaveLength(1);
    expect(S.card.limits.dailySpent).toBe(12);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      "webhook.payload_mismatch",
      "system",
      expect.objectContaining({ provider: "card-auth" })
    );
  });

  it("durable store unavailable: 503, nothing approved or booked", async () => {
    S.dbDown = true;
    const res = await deliver(authBody("iauth_1"));
    expect(res.status).toBe(503);
    expect(S.settled).toHaveLength(0);
    expect(S.card.limits.dailySpent).toBe(0);
  });

  it("KV throwing: 500, nothing booked, durable row released", async () => {
    S.kvMode = "throw";
    const res = await deliver(authBody("iauth_1"));
    expect(res.status).toBe(500);
    expect(S.settled).toHaveLength(0);
    expect(S.rows.get("card-auth|iauth_1")?.status).toBe("failed");
  });

  it("handler failure then issuer retry: booked exactly once", async () => {
    vi.mocked(recordTransaction).mockImplementationOnce(() => {
      throw new Error("store write failed");
    });
    const first = await deliver(authBody("iauth_1"));
    expect(first.status).toBe(500);
    expect(S.rows.get("card-auth|iauth_1")?.status).toBe("failed");

    const retry = await deliver(authBody("iauth_1"));
    expect(await retry.json()).toMatchObject({ approved: true });
    expect(S.settled).toHaveLength(1);
  });

  it("invalid signature: 400, never reaches the durable store", async () => {
    const res = await deliver(authBody("iauth_1"), "forged");
    expect(res.status).toBe(400);
    expect(S.rows.size).toBe(0);
    expect(S.settled).toHaveLength(0);
  });

  it("store not provisioned (dev/test): durable layer bypassed, KV path unchanged", async () => {
    S.backend = "memory";
    await deliver(authBody("iauth_1"));
    const dup = await deliver(authBody("iauth_1"));
    expect(await dup.json()).toMatchObject({ deduped: true });
    expect(S.settled).toHaveLength(1);
    expect(S.rows.size).toBe(0);
  });
});
