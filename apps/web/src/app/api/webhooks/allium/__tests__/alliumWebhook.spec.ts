import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route against mocked storage: every Supabase call is recorded so the
// tests can assert WHICH tables/functions were touched (and that no ledger,
// balance or payment table ever is).
const calls: { kind: string; target: string; arg?: unknown }[] = [];
const state = { seenNonces: new Set<string>(), failIngest: false, linked: new Map<string, string>() };

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", target: fn, arg: args });
    if (fn === "onchain_ingest") {
      if (state.failIngest) throw new Error("ECONNREFUSED");
      return { inserted: (args.p_events as unknown[]).length, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0 };
    }
    if (fn === "onchain_claim_nonce") {
      state.seenNonces.add(String(args.p_nonce));
      return true;
    }
    return null;
  }),
  sbSelect: vi.fn(async (table: string, q: string) => {
    calls.push({ kind: "select", target: table, arg: q });
    if (table === "onchain_webhook_nonces") {
      const n = /nonce=eq\.([0-9a-f-]+)/.exec(q)?.[1] ?? "";
      return state.seenNonces.has(n) ? [{ nonce: n }] : [];
    }
    if (table === "linked_wallets") {
      const a = /address_norm=eq\.(0x[0-9a-f]{40})/.exec(q)?.[1] ?? "";
      const u = state.linked.get(a);
      return u ? [{ user_id: u }] : [];
    }
    return [];
  }),
  sbInsertIgnoreDuplicates: vi.fn(async (table: string, row: unknown) => {
    calls.push({ kind: "insert", target: table, arg: row });
  }),
}));
vi.mock("@/lib/rateLimit", async (orig) => ({ ...(await orig<typeof import("@/lib/rateLimit")>()), limit: vi.fn(async () => ({ ok: true })) }));

import { POST } from "../route";
import { signBeam } from "@/lib/onchain/beamAuth";

const SECRET = "k".repeat(48);
const HASH = "0x" + "ab".repeat(32);
const USER_WALLET = "0x" + "22".repeat(20);
const STRANGER = "0x" + "33".repeat(20);
const record = (over: Record<string, unknown> = {}) => ({
  chain: "base",
  transaction_hash: HASH,
  log_index: 7,
  block_number: 21_000_000,
  block_hash: "0x" + "cd".repeat(32),
  block_timestamp: new Date(Date.now() - 60_000).toISOString(),
  from_address: "0x" + "11".repeat(20),
  to_address: USER_WALLET,
  token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  token_symbol: "USDC",
  raw_amount_str: "1250000000",
  amount_str: "1250",
  usd_amount: 1250,
  ...over,
});

let n = 0;
function req(body: unknown, opts: { nonce?: string; secret?: string; ts?: number; headers?: Record<string, string> } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const nonce = opts.nonce ?? `6f1c2c1e-6a51-4d8b-9a56-${String(++n).padStart(12, "0")}`;
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  return new Request("https://furlpay.com/api/webhooks/allium", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": ts,
      "x-webhook-nonce": nonce,
      "x-signature-256": signBeam(opts.secret ?? SECRET, nonce, ts, Buffer.from(raw)),
      ...opts.headers,
    },
  });
}
const FORBIDDEN = /ledger|balance|payment|settlement|withdraw|financial_effect|ops_tx_events|users$/;

beforeEach(() => {
  process.env.ALLIUM_BEAM_WEBHOOK_SECRET = SECRET;
  calls.length = 0;
  state.seenNonces.clear();
  state.failIngest = false;
  state.linked = new Map([[USER_WALLET, "6c2f6f1e-0000-4000-8000-000000000001"]]);
});
afterEach(() => {
  delete process.env.ALLIUM_BEAM_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/allium", () => {
  it("ingests a valid signed record for a tracked (linked) wallet, then claims the nonce", async () => {
    const res = await POST(req(record()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", received: 1, rejected: 0, out_of_scope: 0, inserted: 1 });
    const ingest = calls.find((c) => c.target === "onchain_ingest")!;
    const [ev] = (ingest.arg as { p_events: Record<string, unknown>[] }).p_events;
    expect(ev).toMatchObject({ event_key: `base:${HASH}:7`, scope: "user", direction: "in", user_id: "6c2f6f1e-0000-4000-8000-000000000001", amount_raw: "1250000000", confirmation_state: "confirmed" });
    expect(calls.findIndex((c) => c.target === "onchain_claim_nonce")).toBeGreaterThan(calls.findIndex((c) => c.target === "onchain_ingest"));
  });

  it("rejects an invalid signature (401) and touches no storage", async () => {
    const res = await POST(req(record(), { secret: "x".repeat(48) }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects a stale timestamp (401)", async () => {
    expect((await POST(req(record(), { ts: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
  });

  it("refuses everything when the secret is not configured (503, fail closed)", async () => {
    delete process.env.ALLIUM_BEAM_WEBHOOK_SECRET;
    expect((await POST(req(record()))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("treats a replayed nonce as a no-op", async () => {
    const nonce = "6f1c2c1e-6a51-4d8b-9a56-aaaaaaaaaaaa";
    expect((await POST(req(record(), { nonce }))).status).toBe(200);
    const before = calls.filter((c) => c.target === "onchain_ingest").length;
    const res = await POST(req(record(), { nonce }));
    expect(await res.json()).toEqual({ status: "replay" });
    expect(calls.filter((c) => c.target === "onchain_ingest").length).toBe(before);
  });

  it("does NOT claim the nonce when the store fails, so the redelivery is processed", async () => {
    const nonce = "6f1c2c1e-6a51-4d8b-9a56-bbbbbbbbbbbb";
    state.failIngest = true;
    expect((await POST(req(record(), { nonce }))).status).toBe(503);
    expect(state.seenNonces.has(nonce)).toBe(false);
    state.failIngest = false;
    const res = await POST(req(record(), { nonce }));
    expect((await res.json()).status).toBe("ok");
  });

  it("dead-letters malformed records with 200 (no infinite provider retries)", async () => {
    const res = await POST(req([{ nonsense: true }, record()]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 2, rejected: 1, inserted: 1 });
    expect(calls.some((c) => c.kind === "insert" && c.target === "onchain_dead_letters")).toBe(true);
  });

  it("dead-letters invalid JSON", async () => {
    const res = await POST(req("{not json"));
    expect(await res.json()).toMatchObject({ status: "dead_lettered", reason: "invalid_json" });
  });

  it("drops activity on addresses FurlPay does not track (stored nowhere)", async () => {
    const res = await POST(req(record({ to_address: STRANGER })));
    expect(await res.json()).toMatchObject({ out_of_scope: 1, inserted: 0 });
    expect(calls.some((c) => c.target === "onchain_ingest")).toBe(false);
  });

  it("enforces content-type and size limits before verifying", async () => {
    const r1 = req(record(), { headers: { "content-type": "text/plain" } });
    expect((await POST(r1)).status).toBe(415);
    const big = req(record(), { headers: { "content-length": "5000000" } });
    expect((await POST(big)).status).toBe(413);
  });

  it("caps a chunked body by streamed size, without a Content-Length to trust", async () => {
    // 2 MB in 64 KiB chunks and no Content-Length: the old arrayBuffer() read
    // buffered all of it before checking. The bounded reader stops at 1 MB.
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 2_000_000) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const r = new Request("https://furlpay.com/api/webhooks/allium", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await POST(r)).status).toBe(413);
    // It stopped reading shortly after the cap rather than draining the stream.
    expect(sent).toBeLessThan(1_000_000 + 3 * chunk.byteLength);
  });

  it("is the one reviewed exception to the 100 KiB API body gate, at the same 1 MB cap", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const mw = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "webhooks", "allium", "route.ts"), "utf8");
    const block = mw.slice(mw.indexOf("const LARGE_BODY_ROUTES"), mw.indexOf("};", mw.indexOf("const LARGE_BODY_ROUTES")));
    expect([...block.matchAll(/^\s*"(\/api[^"]+)":/gm)].map((m) => m[1])).toEqual(["/api/webhooks/allium"]);
    const mwCap = Number(/"\/api\/webhooks\/allium":\s*([\d_]+)/.exec(block)![1].replace(/_/g, ""));
    const routeCap = Number(/const MAX_BODY = ([\d_]+);/.exec(route)![1].replace(/_/g, ""));
    expect(mwCap).toBe(routeCap);
  });

  it("five deliveries of one event produce five idempotent ingest calls with the SAME key — and never touch money", async () => {
    for (let i = 0; i < 5; i++) await POST(req(record()));
    const keys = calls.filter((c) => c.target === "onchain_ingest").map((c) => (c.arg as { p_events: { event_key: string }[] }).p_events[0].event_key);
    expect(new Set(keys).size).toBe(1);
    // Exactly-one-row under concurrency is proven against real Postgres in
    // scripts/db/verify-onchain-ingest.mjs (I-1). Here: no financial surface.
    for (const c of calls) expect(c.target).not.toMatch(FORBIDDEN);
  });
});
