import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { postgrest, startPg } from "./pgHarness";

// END-TO-END on REAL Ethereum mainnet + a REAL PostgreSQL 18 (migration 0036).
// Skipped unless ONCHAIN_LIVE_E2E=1. Only the PostgREST transport is replaced.
//
//   1. anchor ~150 finalized blocks back; history = 2 units of 500 blocks;
//   2. the live pass commits every finalized block since the anchor, the
//      backfill pass commits the history (keyless provider pool, no Alchemy);
//   3. counts, raw sums, mints, burns and transaction counts equal an
//      INDEPENDENT recount straight from a provider's eth_getLogs;
//   4. windows/state are materialised and the dashboard panel renders them.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1";
const h = vi.hoisted(() => ({ rest: null as unknown as ReturnType<typeof import("./pgHarness").postgrest> }));
vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: (t: string, q: string) => h.rest.sbSelect(t, q),
  sbRpc: (f: string, a: Record<string, unknown>) => h.rest.sbRpc(f, a),
}));

import { backfillPass, livePass, runUsdcIndex, USDC_ETHEREUM } from "../indexer";
import { RpcPool } from "../rpcPool";
import { TRANSFER_TOPIC } from "../scan";

// Reference readers for the independent recount, rotated on rate limits.
const REFS = ["https://eth-mainnet.public.blastapi.io", "https://mainnet.gateway.tenderly.co", "https://rpc.mevblocker.io"];
let refI = 0;
const ZERO_T = `0x${"0".repeat(64)}`;
async function rpc<T>(_url: string, method: string, params: unknown[]): Promise<T> {
  for (let i = 0; ; i++) {
    const url = REFS[refI % REFS.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const b = (await r.json()) as { result?: T; error?: { message: string } };
      if (b.error) throw new Error(b.error.message);
      return b.result as T;
    } catch (e) {
      if (i >= 30) throw e;
      refI++;
      await new Promise((r) => setTimeout(r, 1000 * Math.min(i + 1, 10)));
    }
  }
}
async function recount(from: number, to: number) {
  let n = 0, mints = 0, burns = 0, sum = 0n;
  const txs = new Set<string>();
  for (let a = from; a <= to; a += 10) {
    const logs = await rpc<{ topics: string[]; data: string; transactionHash: string }[]>("", "eth_getLogs", [{ address: USDC_ETHEREUM, topics: [TRANSFER_TOPIC], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${Math.min(to, a + 9).toString(16)}` }]);
    for (const l of logs) {
      n++;
      sum += BigInt(l.data);
      txs.add(l.transactionHash.toLowerCase());
      if (l.topics[1] === ZERO_T) mints++;
      else if (l.topics[2] === ZERO_T) burns++;
    }
  }
  return { n, mints, burns, sum: sum.toString(), txs: txs.size };
}

let pool: pg.Pool;
let stop: () => Promise<void>;
let anchor = 0;
let deploy = 0;

describe.skipIf(!LIVE)("Ethereum USDC index, live mainnet -> PostgreSQL", () => {
  beforeAll(async () => {
    const s = await startPg(15471);
    pool = s.pool;
    stop = s.stop;
    h.rest = postgrest(pool);
    const fin = await rpc<{ number: string }>("", "eth_getBlockByNumber", ["finalized", false]);
    anchor = Number(BigInt(fin.number)) - 150;
    deploy = anchor - 999;
    const hdr = await rpc<{ hash: string; timestamp: string }>("", "eth_getBlockByNumber", [`0x${anchor.toString(16)}`, false]);
    await pool.query("update usdc_index_streams set deploy_block = $1 where stream = 1", [deploy]);
    await pool.query("select usdc_index_anchor(1::smallint, $1, $2, $3, 500)", [anchor, hdr.hash.toLowerCase(), new Date(Number(BigInt(hdr.timestamp)) * 1000).toISOString()]);
  }, 120_000);
  afterAll(async () => stop?.());

  it("indexes live finalized ranges and the history, equal to an independent recount", async () => {
    const p = new RpcPool();
    const live = await livePass(p, () => false);
    console.log(`  live: ${live.status} ${live.from}..${live.to}, ${live.commits} commits, ${live.events} events, ${live.durationMs} ms; ${live.errors.join("; ") || "no errors"}`);
    expect(["ok", "caught_up"]).toContain(live.status);
    const back = await backfillPass(p, () => false);
    console.log(`  backfill: ${back.status} ${back.from}..${back.to}, ${back.commits} commits, ${back.events} events, ${back.durationMs} ms; ${back.errors.join("; ") || "no errors"}`);
    expect(back.status).toBe("ok");
    const st = (await pool.query("select cursor_block::int c, backfill_through::int b, live_from_block::int l from usdc_index_state")).rows[0];
    expect(st.b).toBe(st.l - 1);
    const ref = await recount(deploy, st.c);
    const db = (await pool.query("select events::int n, mints::int m, burns::int b, (transfer_raw + mint_raw + burn_raw)::text s, tx_count::int t from usdc_totals")).rows[0];
    console.log(`  blocks ${deploy}..${st.c}: index ${db.n} events / ${db.t} tx; independent ${ref.n} events / ${ref.txs} tx`);
    expect([db.n, db.m, db.b, db.s, db.t]).toEqual([ref.n, ref.mints, ref.burns, ref.sum, ref.txs]);
    const raw = (await pool.query("select count(*)::int n from usdc_transfers")).rows[0].n;
    expect(raw).toBe(ref.n); // all within the 30-day retention
    console.log("  providers:", JSON.stringify(p.health().map((x) => [x.host, x.ok, x.rangeErrors, x.rateLimited, x.span])));
  }, 600_000);

  it("materialises state + windows and the panel renders them", async () => {
    const out = await runUsdcIndex({ deadline: () => false, backfillDeadline: () => false });
    expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
    const { usdcIndexView } = await import("../view");
    const v = await usdcIndexView();
    expect(v.available).toBe(true);
    expect(v.state).toBe("LIVE");
    expect(BigInt(v.supply.raw!)).toBeGreaterThan(10n ** 15n);
    const tot = (await pool.query("select events::int n from usdc_totals")).rows[0].n;
    expect((v.windows.all as { events: number }).events).toBe(tot);
    console.log(`  state ${v.state}; head ${v.head.block}; finalized ${v.finalized.block}; indexed ${v.indexed.block}; lag ${v.lagBlocks}; supply ${v.supply.raw}; 1h ${JSON.stringify(v.windows["1h"]).slice(0, 200)}`);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { UsdcIndexPanelView } = await import("@/components/onchain/usdcIndex");
    const html = renderToStaticMarkup(createElement(UsdcIndexPanelView, { data: v, error: null, lastOk: Date.now() }));
    expect(html).toContain("LIVE");
    expect(html).toContain(`Indexed #${v.indexed.block!.toLocaleString("en-US")}`);
    expect(html).not.toContain("Not computed yet");
  }, 300_000);
});
