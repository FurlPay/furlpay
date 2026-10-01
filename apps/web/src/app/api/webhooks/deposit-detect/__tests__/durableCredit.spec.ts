import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// deposit-detect in DURABLE mode (Postgres present): recipient resolution and
// the durable claim.
//
// T-W4 (audit P1-12). The owner of a deposit address is resolved from the
// linked_wallets table (its primary key), NOT from accounts loaded into this
// instance. A known address resolves even when no instance has that account in
// memory; an address nobody linked is a legitimate 200 ignored_address; and a
// FAILED lookup is a 503 so the provider retries — never a silent "ignored".
//
// T-L4 (audit P1-11). Whatever happens, no token balance is written: a deposit
// to a user's own wallet is activity, the chain is the record.
//
// The route, withDurableWebhook and the webhook_events client are real; the
// database is an in-memory double of the SQL in 0022/0024 plus the
// linked_wallets lookup.
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => {
  type Row = { status: string; hash: string; startedAt: number };
  return {
    rows: new Map<string, Row>(),
    linked: new Map<string, string>(), // address_norm -> user_id
    lookupDown: false,
    notified: [] as unknown[],
    balanceWrites: 0,
    kv: new Set<string>(),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  SupabaseFunctionMissing: class extends Error {},
  sbSelect: vi.fn(async (table: string, query: string) => {
    if (table !== "linked_wallets") throw new Error(`unexpected select ${table}`);
    if (S.lookupDown) throw new Error("PostgREST 503");
    const m = /address_norm=eq\.(0x[0-9a-f]{40})/.exec(query);
    const owner = m ? S.linked.get(m[1]) : undefined;
    return owner ? [{ user_id: owner }] : [];
  }),
  sbRpc: vi.fn(async (fn: string, a: Record<string, string>) => {
    const key = `${a.p_provider}|${a.p_provider_event_id}`;
    const row = S.rows.get(key);
    if (fn === "claim_webhook_event") {
      if (!row) {
        S.rows.set(key, { status: "processing", hash: a.p_payload_hash, startedAt: 0 });
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      const reclaimable = row.status === "failed" && row.hash === a.p_payload_hash;
      if (reclaimable) {
        row.status = "processing";
        return [{ claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false }];
      }
      return [{ claimed: false, duplicate: true, existing_status: row.status, payload_mismatch: row.hash !== a.p_payload_hash }];
    }
    if (fn === "mark_webhook_processed" && row) row.status = "processed";
    if (fn === "mark_webhook_failed" && row) row.status = "failed";
    return undefined;
  }),
}));

vi.mock("@/lib/services/deposits", () => ({
  recordDepositEvent: vi.fn(async (i: { confirmations: number }) => ({
    status: i.confirmations >= 12 ? "success" : "processing",
    confirmations: i.confirmations,
    orderId: undefined,
  })),
  // Open on purpose: prove the DURABLE claim dedupes, not KV.
  claimDepositNotification: vi.fn(async () => true),
}));
vi.mock("@/lib/store", () => ({
  // Not loaded in "this instance": resolution must come from the table.
  findUserByLinkedWallet: () => undefined,
  getAccount: () => undefined,
  getAccountDurable: vi.fn(async (id: string) => ({
    user: { id, email: "" },
    get tokenBalances() {
      S.balanceWrites++;
      return [];
    },
  })),
  newTx: (t: unknown) => t,
  recordTransaction: vi.fn((_id: string, t: unknown) => S.notified.push(t)),
}));
vi.mock("@/lib/services/swap", () => ({ usdPrice: () => 1 }));
vi.mock("@/lib/rateLimit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rateLimit")>()),
  limit: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/emailTemplates", () => ({ depositReceivedEmail: () => ({}) }));
vi.mock("@/lib/lockLink", () => ({ lockLinkFor: () => null }));
vi.mock("@/lib/webhookOrdering", () => ({
  occurredAtMs: () => Date.now(),
  staleEvent: vi.fn(async () => false),
  recordApplied: vi.fn(async () => undefined),
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "../route";
import { audit } from "@/lib/audit";

const SECRET = "deposit-test-secret";
const OWNED = "0x00000000000000000000000000000000000000aa";
const HASH = "0x" + "ab".repeat(32);

function body(to: string, confirmations = 30, hash = HASH, rawValue = "50000000000000000000"): string {
  return JSON.stringify({
    network: "bsc",
    token: "USDT",
    decimals: 18,
    confirmations,
    transaction: { hash, logIndex: 3, to, from: "0x" + "11".repeat(20), rawValue },
  });
}
function deliver(b: string) {
  const sig = crypto.createHmac("sha256", SECRET).update(b).digest("hex");
  return POST(new Request("http://localhost/api/webhooks/deposit-detect", { method: "POST", body: b, headers: { "x-qn-signature": sig } }));
}

beforeEach(() => {
  process.env.DEPOSIT_WEBHOOK_SECRET = SECRET;
  delete process.env.TREASURY_ADDRESS_BSC;
  S.rows.clear();
  S.linked.clear();
  S.linked.set(OWNED, "user_1");
  S.lookupDown = false;
  S.notified.length = 0;
  S.balanceWrites = 0;
  vi.mocked(audit).mockClear();
});

describe("deposit-detect — durable resolution (T-W4) and no balance claim (T-L4)", () => {
  it("resolves the owner from linked_wallets even though no instance has the account loaded", async () => {
    const res = await deliver(body(OWNED));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "processed" });
    expect(S.notified).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith("deposit.self_custody_observed", "user_1", expect.objectContaining({ amount: "50.000000000000000000" }));
  });

  it("a FAILED lookup is 503 (retryable), never 200 ignored_address", async () => {
    S.lookupDown = true;
    const res = await deliver(body(OWNED));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "recipient_lookup_unavailable" });
    expect(S.notified).toHaveLength(0);
  });

  it("an address nobody linked is a legitimate 200 ignored_address", async () => {
    const res = await deliver(body("0x" + "cd".repeat(20)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ignored_address" });
  });

  it("redeliveries with KV open: the durable claim notifies once", async () => {
    for (let i = 0; i < 5; i++) expect((await deliver(body(OWNED))).status).toBe(200);
    expect(S.notified).toHaveLength(1);
    expect(S.rows.get(`deposit-activity|deposit:bsc:${HASH}:3`)?.status).toBe("processed");
  });

  it("same transfer, different amount: 400 payload_mismatch, audited, no second notice", async () => {
    await deliver(body(OWNED));
    const res = await deliver(body(OWNED, 30, HASH, "99000000000000000000"));
    expect(res.status).toBe(400);
    expect(audit).toHaveBeenCalledWith("webhook.payload_mismatch", "system", expect.anything());
    expect(S.notified).toHaveLength(1);
  });

  it("never reads or writes a token balance (T-L4)", async () => {
    await deliver(body(OWNED));
    expect(S.balanceWrites).toBe(0);
  });

  it("a treasury deposit is recorded as unattributed and notifies no one", async () => {
    process.env.TREASURY_ADDRESS_BSC = "0x" + "ee".repeat(20);
    const res = await deliver(body("0x" + "ee".repeat(20)));
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith("deposit.unattributed", "system", expect.anything());
    expect(S.notified).toHaveLength(0);
  });
});
