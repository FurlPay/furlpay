import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Deposit webhook, end to end through the REAL route and REAL store.
//
// WHAT CHANGED (audit P1-11, P1-13) AND IS PINNED HERE:
//
//   T-L4  A deposit to a user's VERIFIED LINKED WALLET is a transfer into the
//         user's own self-custody key. The coins are already theirs on-chain;
//         the route used to ALSO add them to account.tokenBalances — a second,
//         spendable claim on the same asset. It now records ACTIVITY only: the
//         internal balance does not move, however many times it is delivered.
//   Replay  Redeliveries (sequential and concurrent) produce ONE activity row.
//   T-W5  Amounts are exact: 10^24 base units at 18 decimals is 1,000,000
//         exactly, and a JSON-number amount, a missing network/token/log index
//         or missing decimals is a 400 — nothing is defaulted.
//
// Dev-mode store (no Postgres): the durable claim is bypassed and the
// notification's KV first-sight guard is what dedupes; in production the
// webhook_events claim (0022/0024) is the authority (see durableCredit.spec).
// ---------------------------------------------------------------------------

const SECRET = "whsec_deposit_replay_spec";
const WATCHED = "0x00000000000000000000000000000000000000ff";

let POST: (req: Request) => Promise<Response>;
let userId = "";
let getAccount: typeof import("@/lib/store").getAccount;

const sign = (body: string) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");
const txHash = (seed: string) => "0x" + crypto.createHash("sha256").update(seed).digest("hex");

function delivery(fields: Record<string, unknown>): Request {
  const body = JSON.stringify({
    network: "bsc",
    token: "USDT",
    decimals: 18,
    transaction: {
      hash: txHash("default"),
      logIndex: 0,
      from: "0x1111111111111111111111111111111111111111",
      to: WATCHED,
      value: "1500000000000000000", // 1.5 USDT (BEP-20, 18 decimals)
    },
    confirmations: 30,
    timestamp: new Date().toISOString(),
    ...fields,
  });
  return new Request("https://furlpay.test/api/webhooks/deposit-detect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qn-signature": sign(body),
      "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 200)}`,
    },
    body,
  });
}
const tx = (hash: string, extra: Record<string, unknown> = {}) => ({
  transaction: {
    hash,
    logIndex: 0,
    from: "0x1111111111111111111111111111111111111111",
    to: WATCHED,
    value: "1500000000000000000",
    ...extra,
  },
});

const saved: Record<string, string | undefined> = {};
const receivedRows = (hash: string) =>
  getAccount(userId)!.transactions.filter((t) => t.subtitle.includes(hash.slice(0, 10)));

beforeAll(async () => {
  for (const k of ["DEPOSIT_WEBHOOK_SECRET", "TREASURY_ADDRESS_BSC"]) saved[k] = process.env[k];
  process.env.DEPOSIT_WEBHOOK_SECRET = SECRET;
  delete process.env.TREASURY_ADDRESS_BSC;
  const store = await import("@/lib/store");
  getAccount = store.getAccount;
  const { account } = store.findOrCreateUserByIdentity({ email: `replay-${Date.now()}@furlpay.test`, name: "Replay Probe" });
  userId = account.user.id;
  store.setLinkedWallet(account.user.id, {
    address: WATCHED,
    chainFamily: "evm",
    verificationMethod: "eip191",
    verifiedAt: new Date().toISOString(),
    linkVersion: 1,
    status: "active",
    proofNonce: "replay-spec",
  } as Parameters<typeof store.setLinkedWallet>[1]);
  ({ POST } = await import("../route"));
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("self-custody deposit: activity, never a balance claim (T-L4)", () => {
  it("reaches the handler — the control", async () => {
    const res = await POST(delivery(tx(txHash("control"))));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("processed");
  });

  it("does not create or change any internal token balance", async () => {
    const before = JSON.stringify(getAccount(userId)!.tokenBalances);
    const hash = txHash("no-balance");
    const res = await POST(delivery(tx(hash)));
    expect(res.status).toBe(200);
    expect(JSON.stringify(getAccount(userId)!.tokenBalances)).toBe(before);
    const rows = receivedRows(hash);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Received 1.5 USDT");
    expect(rows[0].direction).toBe("in");
  });

  it("three SEQUENTIAL redeliveries → one activity row, no balance", async () => {
    const before = JSON.stringify(getAccount(userId)!.tokenBalances);
    const hash = txHash("sequential");
    for (let i = 0; i < 3; i++) expect((await POST(delivery(tx(hash)))).status).toBe(200);
    expect(receivedRows(hash)).toHaveLength(1);
    expect(JSON.stringify(getAccount(userId)!.tokenBalances)).toBe(before);
  });

  it("ten CONCURRENT redeliveries → one activity row", async () => {
    const hash = txHash("concurrent");
    const results = await Promise.all(Array.from({ length: 10 }, () => POST(delivery(tx(hash)))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(receivedRows(hash)).toHaveLength(1);
  });

  it("a different log index in the same transaction is a different transfer", async () => {
    const hash = txHash("two-logs");
    await POST(delivery(tx(hash, { logIndex: 0 })));
    await POST(delivery(tx(hash, { logIndex: 1 })));
    expect(receivedRows(hash)).toHaveLength(2);
  });

  it("an address nobody linked is ignored, not attributed", async () => {
    const res = await POST(delivery(tx(txHash("stranger"), { to: "0x2222222222222222222222222222222222222222" })));
    expect(await res.json()).toMatchObject({ status: "ignored_address" });
  });
});

describe("exact amounts, nothing defaulted (T-W5)", () => {
  it("10^24 base units at 18 decimals is exactly 1,000,000", async () => {
    const hash = txHash("huge");
    const res = await POST(delivery(tx(hash, { value: "1000000000000000000000000" })));
    expect(res.status).toBe(200);
    expect(receivedRows(hash)[0].title).toBe("Received 1000000 USDT");
  });

  it.each([
    ["missing network", { network: undefined }, "network_required"],
    ["missing token", { token: undefined }, "token_required"],
    ["missing decimals", { decimals: undefined }, "decimals_required"],
  ])("%s → 400 %s", async (_l, override, error) => {
    const res = await POST(delivery({ ...tx(txHash(`missing-${error}`)), ...override }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
  });

  it("a JSON-number amount (already a lossy float) → 400", async () => {
    const res = await POST(delivery(tx(txHash("float"), { value: 1.5e18 })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "amount_must_be_base_unit_string" });
  });

  it("a missing log index → 400", async () => {
    const res = await POST(delivery(tx(txHash("no-log"), { logIndex: undefined })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "log_index_required" });
  });
});
