import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { kind: string; target: string; arg?: unknown }[] = [];
const db = { stored: [] as { event_key: string }[], ledger: [] as Record<string, unknown>[] };

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", target: fn, arg: args });
    if (fn === "onchain_ingest") return { inserted: (args.p_events as unknown[]).length, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0 };
    return true;
  }),
  sbSelect: vi.fn(async (table: string, q: string) => {
    calls.push({ kind: "select", target: table, arg: q });
    if (table === "linked_wallets" && q.includes("address_norm=eq.")) return [{ user_id: "6c2f6f1e-0000-4000-8000-000000000001" }];
    if (table === "linked_wallets") return [{ address_norm: WALLET }];
    if (table === "onchain_events") return db.stored;
    if (table === "ops_tx_events") return db.ledger;
    return [];
  }),
  sbInsert: vi.fn(async (table: string) => {
    calls.push({ kind: "insert", target: table });
    return [{ id: 42 }];
  }),
  sbUpdate: vi.fn(async (table: string, _q: string, patch: unknown) => {
    calls.push({ kind: "update", target: table, arg: patch });
    return [];
  }),
  sbUpsert: vi.fn(async (table: string) => {
    calls.push({ kind: "upsert", target: table });
    return [];
  }),
}));
vi.mock("@/lib/ops/financialAlerts", () => ({ raiseFinancialAlert: vi.fn(async () => undefined) }));

import { __resetChainCache, alliumCall, correlateLedger, discoverChains, syncOnchain } from "../sync";
import { searchEvents } from "../live";

const WALLET = "0x" + "22".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const now = Date.now();

const chainsResponse = [
  { id: "base", chain_type: "EVM", endpoints: { wallet_transactions: { availability: "ga" } } },
  { id: "ethereum", chain_type: "EVM", endpoints: { wallet_transactions: { availability: "ga" } } },
  { id: "solana", chain_type: "solana", endpoints: { wallet_transactions: { availability: "ga" } } },
  { id: "foochain", chain_type: "EVM", endpoints: { wallet_transactions: null } },
];
const walletPage = (cursor: string | null, at = new Date(now - 5 * 3600_000).toISOString()) => ({
  items: [
    {
      id: "1",
      chain: "base",
      hash: HASH,
      block_timestamp: at,
      block_number: 5,
      block_hash: "0x" + "cd".repeat(32),
      asset_transfers: [{ transfer_type: "received", transaction_hash: HASH, log_index: 1, from_address: "0x" + "11".repeat(20), to_address: WALLET, asset: { type: "evm_erc20", symbol: "USDC", decimals: 6 }, amount: { raw_amount: "5000000", amount_str: "5" } }],
    },
  ],
  cursor,
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const f = vi.fn(handler);
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  calls.length = 0;
  db.stored = [];
  db.ledger = [];
  __resetChainCache();
  process.env.ALLIUM_API_KEY = "test-key";
  process.env.ONCHAIN_SYNC_CHAINS = "base";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLIUM_API_KEY;
  delete process.env.ONCHAIN_SYNC_CHAINS;
});

describe("alliumCall", () => {
  it("retries 429 with backoff, then succeeds", async () => {
    let n = 0;
    mockFetch(() => (++n < 2 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : Response.json({ ok: 1 })));
    await expect(alliumCall("/x")).resolves.toEqual({ ok: 1 });
    expect(n).toBe(2);
  });
  it("does not retry a 401 and names the key", async () => {
    let n = 0;
    mockFetch(() => (++n, new Response("", { status: 401 })));
    await expect(alliumCall("/x")).rejects.toThrow("check ALLIUM_API_KEY");
    expect(n).toBe(1);
  });
  it("gives up after 3 attempts on 5xx", async () => {
    let n = 0;
    mockFetch(() => (++n, new Response("", { status: 503 })));
    await expect(alliumCall("/x")).rejects.toThrow("503");
    expect(n).toBe(3);
  }, 10_000);
  it("refuses without a key and makes no request", async () => {
    delete process.env.ALLIUM_API_KEY;
    const f = mockFetch(() => Response.json({}));
    await expect(alliumCall("/x")).rejects.toThrow("ALLIUM_API_KEY");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("discoverChains", () => {
  it("uses Allium's availability list, filtered by the allowlist", async () => {
    delete process.env.ONCHAIN_SYNC_CHAINS;
    mockFetch(() => Response.json(chainsResponse));
    const c = await discoverChains();
    expect(c.evm).toEqual(["base", "ethereum"]);
    expect(c.all).toEqual(["base", "ethereum", "solana"]);
  });
});

describe("syncOnchain", () => {
  it("is not_configured without a key (records nothing)", async () => {
    delete process.env.ALLIUM_API_KEY;
    const r = await syncOnchain("reconcile", { lookbackHours: 26, deadline: () => false });
    expect(r.status).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  it("backfills, promotes past-finality events to finalized, and marks a vanished event reorged — only for a fully paginated window", async () => {
    db.stored = [{ event_key: `base:${HASH}:1` }, { event_key: "base:0xgone:9" }];
    mockFetch((url) => (url.includes("supported-chains") ? Response.json(chainsResponse) : Response.json(walletPage(null))));
    const r = await syncOnchain("reconcile", { lookbackHours: 26, deadline: () => false });
    expect(r.status).toBe("ok");
    const ingest = calls.find((c) => c.target === "onchain_ingest")!;
    const [ev] = (ingest.arg as { p_events: Record<string, unknown>[] }).p_events;
    expect(ev).toMatchObject({ event_key: `base:${HASH}:1`, confirmation_state: "finalized", scope: "user", source: "allium_realtime_api" });
    const marked = calls.filter((c) => c.target === "onchain_mark_reorged").map((c) => (c.arg as { p_event_key: string }).p_event_key);
    expect(marked).toEqual(["base:0xgone:9"]);
    expect(r.markedReorged).toBe(1);
    expect(calls.some((c) => c.kind === "update" && c.target === "onchain_reconciliation_runs")).toBe(true);
  });

  it("never marks reorgs when pagination was cut short", async () => {
    db.stored = [{ event_key: "base:0xgone:9" }];
    mockFetch((url) => (url.includes("supported-chains") ? Response.json(chainsResponse) : Response.json(walletPage("next-page"))));
    await syncOnchain("reconcile", { lookbackHours: 26, deadline: () => false });
    expect(calls.some((c) => c.target === "onchain_mark_reorged")).toBe(false);
  });

  it("stops as 'partial' (recorded) when the budget expires", async () => {
    mockFetch((url) => (url.includes("supported-chains") ? Response.json(chainsResponse) : Response.json(walletPage(null))));
    const r = await syncOnchain("reconcile", { lookbackHours: 26, deadline: () => true });
    expect(r.status).toBe("partial");
    expect(r.errors[0]).toMatch(/budget expired/);
  });
});

describe("correlateLedger", () => {
  it("flags a settled ledger row whose transaction has no matching transfer amount — and writes nothing to the ledger", async () => {
    db.ledger = [{ id: "tx_1", tx_hash: HASH, state: "settled", amount_usd: 500 }];
    const flagged = await correlateLedger([HASH], [{ event_key: `base:${HASH}:1`, tx_hash: HASH, amount_usd: "5.00000000" }]);
    expect(flagged).toBe(1);
    expect(calls.find((c) => c.target === "onchain_flag_ledger")).toBeTruthy();
    expect(calls.filter((c) => c.kind !== "select" && c.target === "ops_tx_events")).toHaveLength(0);
  });
  it("does not flag when amounts agree within 1%", async () => {
    db.ledger = [{ id: "tx_1", tx_hash: HASH, state: "settled", amount_usd: 5 }];
    expect(await correlateLedger([HASH], [{ event_key: `base:${HASH}:1`, tx_hash: HASH, amount_usd: "5.02" }])).toBe(0);
  });
});

describe("searchEvents authorization", () => {
  it("public search is limited to FurlPay-owned scopes; operators search everything", async () => {
    await searchEvents(WALLET, false, null);
    const pub = calls.filter((c) => c.target === "onchain_events").at(-1)!.arg as string;
    expect(pub).toContain("scope=in.(treasury,watch)");
    await searchEvents(WALLET, true, null);
    const op = calls.filter((c) => c.target === "onchain_events").at(-1)!.arg as string;
    expect(op).not.toContain("scope=");
  });
  it("rejects free-form input instead of scanning", async () => {
    expect(await searchEvents("'; drop table onchain_events; --", false, null)).toBeNull();
    expect(await searchEvents("%", false, null)).toBeNull();
  });
  it("paginates with a keyset cursor", async () => {
    await searchEvents("USDC", false, 1234);
    expect(calls.filter((c) => c.target === "onchain_events").at(-1)!.arg as string).toContain("id=lt.1234");
  });
});
