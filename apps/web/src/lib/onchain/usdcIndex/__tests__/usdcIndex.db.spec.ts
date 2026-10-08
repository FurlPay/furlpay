import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { postgrest, startPg } from "./pgHarness";
import { hllAdd, hllCount, hllMerge, newSketch, toHex } from "../hll";
import { TRANSFER_TOPIC, type RawLog } from "../scan";
import type { RpcPool } from "../rpcPool";

// Migration 0036 + the indexer against a REAL PostgreSQL 18, driven by a
// deterministic synthetic chain (no network). Only the PostgREST transport is
// replaced (pgHarness mirrors its wire format).

const h = vi.hoisted(() => ({ pool: null as unknown as pg.Pool, rest: null as unknown as ReturnType<typeof import("./pgHarness").postgrest> }));
vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: (t: string, q: string) => h.rest.sbSelect(t, q),
  sbRpc: (f: string, a: Record<string, unknown>) => h.rest.sbRpc(f, a),
}));

import { backfillPass, livePass, runUsdcIndex, STREAM, USDC_ETHEREUM } from "../indexer";

const word = (a: string) => `0x${a.replace(/^0x/, "").padStart(64, "0")}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const addr = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}`;

/** Synthetic finalized chain: 12 s blocks ending "now", 0–6 USDC logs per block. */
class Chain {
  head: number;
  finalized: number;
  tamperedParent: number | null = null;
  readonly t0: number;
  constructor(readonly start: number, head: number) {
    this.head = head;
    this.finalized = head - 64;
    this.t0 = Math.floor(Date.now() / 1000) - (head - start) * 12;
  }
  hash = (n: number) => `0x${n.toString(16).padStart(64, "a")}`;
  time = (n: number) => this.t0 + (n - this.start) * 12;
  header(n: number) {
    const parent = this.tamperedParent === n ? `0x${"f".repeat(64)}` : this.hash(n - 1);
    return { number: `0x${n.toString(16)}`, hash: this.hash(n), parentHash: parent, timestamp: `0x${this.time(n).toString(16)}` };
  }
  logs(n: number): RawLog[] {
    const k = n % 7;
    const out: RawLog[] = [];
    for (let i = 0; i < k; i++) {
      const from = i === 0 && n % 11 === 0 ? ZERO : addr((n + i) % 53);
      const to = i === 1 && n % 13 === 0 ? ZERO : addr((n * 3 + i) % 71);
      out.push({
        address: USDC_ETHEREUM,
        topics: [TRANSFER_TOPIC, word(from), word(to)],
        data: `0x${BigInt(n * 1_000_003 + i).toString(16).padStart(64, "0")}`,
        blockNumber: `0x${n.toString(16)}`,
        blockHash: this.hash(n),
        blockTimestamp: i % 2 ? "0x0" : `0x${this.time(n).toString(16)}`, // some providers send 0x0
        transactionHash: `0x${(n * 10 + Math.floor(i / 2)).toString(16).padStart(64, "c")}`,
        transactionIndex: `0x${Math.floor(i / 2).toString(16)}`,
        logIndex: `0x${i.toString(16)}`,
      });
    }
    return out;
  }
  events(from: number, to: number) {
    const all: RawLog[] = [];
    for (let n = from; n <= to; n++) all.push(...this.logs(n));
    return all;
  }
  pool(): RpcPool {
    const self = this;
    return {
      health: () => [],
      async rpc(method: string, params: unknown[]) {
        if (method === "eth_getBlockByNumber") {
          const tag = params[0] as string;
          return self.header(tag === "latest" ? self.head : tag === "finalized" ? self.finalized : Number(BigInt(tag)));
        }
        if (method === "eth_call") return `0x${(123_456_789n * 10n ** 6n).toString(16)}`;
        throw new Error(`unexpected ${method}`);
      },
      async getLogsChunk(_f: unknown, from: number, to: number) {
        const end = Math.min(to, from + 37); // odd span on purpose
        return { logs: self.events(from, end), end, host: "synthetic" };
      },
    } as unknown as RpcPool;
  }
}

let stop: () => Promise<void>;
const q = (s: string, v: unknown[] = []) => h.pool.query(s, v);
const chain = new Chain(1_000_000, 1_002_000);
const anchorAt = chain.finalized;

beforeAll(async () => {
  const pg = await startPg(15461);
  h.pool = pg.pool;
  h.rest = postgrest(pg.pool);
  stop = pg.stop;
  // Test stream history: 1,200 blocks before the anchor (3 backfill units of 500/500/200... planned by anchor).
  await q("update usdc_index_streams set deploy_block = $1 where stream = 1", [anchorAt - 1199]);
}, 120_000);
afterAll(async () => stop?.());

const expected = (from: number, to: number) => {
  const ev = chain.events(from, to);
  const raw = ev.map((l) => ({ from: `0x${l.topics[1].slice(26)}`, to: `0x${l.topics[2].slice(26)}`, a: BigInt(l.data) }));
  return {
    n: ev.length,
    transfers: raw.filter((r) => r.from !== ZERO && r.to !== ZERO).length,
    mints: raw.filter((r) => r.from === ZERO).length,
    burns: raw.filter((r) => r.to === ZERO).length,
    sum: raw.reduce((s, r) => s + r.a, 0n),
  };
};

describe("usdc index on PostgreSQL", () => {
  it("anchors at the finalized block, then commits live ranges exactly", async () => {
    const p = chain.pool();
    const first = await livePass(p, () => false);
    expect(first.status).toBe("caught_up");
    const st = (await q("select * from usdc_index_state")).rows[0];
    expect(Number(st.cursor_block)).toBe(anchorAt);
    expect((await q("select count(*)::int n from usdc_backfill_units")).rows[0].n).toBe(3);
    chain.head += 130;
    chain.finalized += 130;
    const r = await livePass(p, () => false);
    expect(r.status, r.errors.join()).toBe("ok");
    expect(r.commits).toBe(3); // 50 + 50 + 30
    const e = expected(anchorAt + 1, chain.finalized);
    const db = (await q("select count(*)::int n, sum(amount_raw)::text s, count(*) filter (where kind = 1)::int m, count(*) filter (where kind = 2)::int b from usdc_transfers")).rows[0];
    expect([db.n, db.s, db.m, db.b]).toEqual([e.n, e.sum.toString(), e.mints, e.burns]);
    const hours = (await q("select sum(transfers + mints + burns)::int n, (sum(transfer_raw) + sum(mint_raw) + sum(burn_raw))::text s from usdc_hourly")).rows[0];
    expect([hours.n, hours.s]).toEqual([e.n, e.sum.toString()]);
    const tot = (await q("select events::int, tx_count::int from usdc_totals")).rows[0];
    expect(tot.events).toBe(e.n);
    const distinctTx = (await q("select count(distinct tx_hash)::int n from usdc_transfers")).rows[0].n;
    expect(tot.tx_count).toBe(distinctTx);
    expect(Number((await q("select cursor_block from usdc_index_state")).rows[0].cursor_block)).toBe(chain.finalized);
  }, 120_000);

  it("refuses a range whose parent hash does not continue the cursor (no rows written)", async () => {
    const before = (await q("select events::int from usdc_totals")).rows[0].events;
    chain.head += 20;
    chain.finalized += 20;
    chain.tamperedParent = (await q("select cursor_block::int c from usdc_index_state")).rows[0].c + 1;
    const r = await livePass(chain.pool(), () => false);
    expect(r.status).toBe("failed");
    expect(r.errors.join()).toMatch(/parent_hash_mismatch/);
    expect((await q("select events::int from usdc_totals")).rows[0].events).toBe(before);
    expect((await q("select count(*)::int n from usdc_index_issues where kind = 'reorg_inconsistency'")).rows[0].n).toBe(1);
    chain.tamperedParent = null;
    expect((await livePass(chain.pool(), () => false)).status).toBe("ok");
  }, 60_000);

  it("two concurrent live passes never double count", async () => {
    chain.head += 200;
    chain.finalized += 200;
    const from = (await q("select cursor_block::int c from usdc_index_state")).rows[0].c + 1;
    const [a, b] = await Promise.all([livePass(chain.pool(), () => false), livePass(chain.pool(), () => false)]);
    expect([a.status, b.status].every((s) => s === "ok" || s === "partial")).toBe(true);
    const e = expected(from, chain.finalized);
    const got = (await q("select count(*)::int n from usdc_transfers where block_number >= $1", [from])).rows[0].n;
    expect(got).toBe(e.n);
    const live = (await q("select sum(events)::int n from usdc_ranges where kind = 'live'")).rows[0].n;
    expect(live).toBe(expected(anchorAt + 1, chain.finalized).n);
  }, 60_000);

  it("re-sending already stored events rolls the whole commit back", async () => {
    const before = (await q("select events::text, transfer_raw::text from usdc_totals")).rows[0];
    const st = (await q("select cursor_block::int c from usdc_index_state")).rows[0];
    const row = (await q("select block_number::int b, log_index, block_time, encode(tx_hash,'hex') tx, encode(sender,'hex') f, encode(recipient,'hex') t, amount_raw::text a, kind from usdc_transfers limit 1")).rows[0];
    const ev = [[row.b, row.log_index, 0, row.tx, row.f, row.t, row.a, row.kind, Math.floor(new Date(row.block_time).getTime() / 1000)]];
    const hour = { bucket: new Date(Math.floor(new Date(row.block_time).getTime() / 3_600_000) * 3_600_000).toISOString(), transfers: row.kind === 0 ? 1 : 0, transfer_raw: row.kind === 0 ? row.a : "0", mints: row.kind === 1 ? 1 : 0, mint_raw: row.kind === 1 ? row.a : "0", burns: row.kind === 2 ? 1 : 0, burn_raw: row.kind === 2 ? row.a : "0", zero_value: 0, first_block: row.b, last_block: row.b, top: [], senders_hll: "", receivers_hll: "" };
    await expect(
      q("select usdc_index_commit(1::smallint, 'live', $1, $1, $2, $3, $4, now(), $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, '{}'::jsonb, true)", [
        st.c + 1, st.c, chain.hash(st.c), chain.hash(st.c + 1), JSON.stringify(ev), JSON.stringify([hour]), JSON.stringify([{ ...hour, bucket: hour.bucket.slice(0, 10) }]),
        JSON.stringify({ events: 1, transfers: hour.transfers, transfer_raw: hour.transfer_raw, mints: hour.mints, mint_raw: hour.mint_raw, burns: hour.burns, burn_raw: hour.burn_raw, zero_value: 0, tx_count: 1 }), "00".repeat(32),
      ])
    ).rejects.toThrow(/events inserted/);
    expect((await q("select events::text, transfer_raw::text from usdc_totals")).rows[0]).toEqual(before);
  });

  it("backfill claims units, stores raw only within retention, and closes the history", async () => {
    const r = await backfillPass(chain.pool(), () => false);
    expect(r.status, r.errors.join()).toBe("ok");
    expect(r.commits).toBe(3);
    const st = (await q("select backfill_through::int b, live_from_block::int l from usdc_index_state")).rows[0];
    expect(st.b).toBe(st.l - 1);
    expect((await backfillPass(chain.pool(), () => false)).status).toBe("caught_up");
    const all = expected(anchorAt - 1199, chain.finalized);
    const tot = (await q("select events::int n, (transfer_raw + mint_raw + burn_raw)::text s from usdc_totals")).rows[0];
    expect([tot.n, tot.s]).toEqual([all.n, all.sum.toString()]);
    const ranges = (await q("select count(*)::int n, sum(events)::int e from usdc_ranges")).rows[0];
    expect(ranges.e).toBe(all.n);
  }, 60_000);

  it("materialises windows and state from aggregates; uniques are HLL within error", async () => {
    const out = await runUsdcIndex({ deadline: () => false, backfillDeadline: () => false, pool: chain.pool() });
    expect(out.ok).toBe(true);
    const st = (await q("select state, windows, supply_raw::text supply, finalized_block::int f, head_block::int hb from usdc_index_state")).rows[0];
    expect(st.state).toBe("LIVE");
    expect(st.supply).toBe((123_456_789n * 10n ** 6n).toString());
    expect([st.f, st.hb]).toEqual([chain.finalized, chain.head]);
    const w = st.windows;
    const all = expected(anchorAt - 1199, chain.finalized);
    expect(w.all.events).toBe(all.n);
    expect(BigInt(w.all.transferRaw) + BigInt(w.all.mintRaw) + BigInt(w.all.burnRaw)).toBe(all.sum);
    // 1h exact vs SQL over the same rows.
    const since = new Date(new Date(w["1h"].to).getTime() - 3_600_000);
    const x = (await q("select count(*)::int n, count(distinct sender) filter (where kind <> 1)::int s from usdc_transfers where block_time > $1 and block_time <= $2", [since, new Date(w["1h"].to)])).rows[0];
    expect([w["1h"].events, w["1h"].uniqueSenders.count]).toEqual([x.n, x.s]);
    // 24h: HLL vs exact distinct, within 3 standard errors (+1 for tiny sets).
    const d24 = (await q("select count(distinct sender) filter (where kind <> 1)::int s from usdc_transfers where block_time >= $1", [w["24h"].from])).rows[0].s;
    expect(Math.abs(w["24h"].uniqueSenders.count - d24)).toBeLessThanOrEqual(Math.ceil(d24 * 3 * 0.0163) + 1);
    expect(w["24h"].uniqueSenders.exact).toBe(false);
    for (const k of ["5m", "1h", "24h", "7d", "30d", "90d", "all"]) expect(w[k].coverage.complete, k).toBe(true);
  }, 60_000);

  it("SQL sketch merge equals the TypeScript merge", async () => {
    const a = newSketch(12), b = newSketch(12);
    for (let i = 0; i < 3000; i++) hllAdd(a, addr(i));
    for (let i = 2000; i < 7000; i++) hllAdd(b, addr(i));
    const sql = (await q("select encode(usdc_hll_merge(decode($1,'hex'), decode($2,'hex')), 'hex') m", [toHex(a), toHex(b)])).rows[0].m;
    expect(sql).toBe(toHex(hllMerge(new Uint8Array(a), b)));
    expect(Math.abs(hllCount(hllMerge(a, b)) - 7000)).toBeLessThan(7000 * 0.05);
    await expect(q("select usdc_hll_merge('\\x00'::bytea, '\\x0000'::bytea)")).rejects.toThrow(/sizes differ/);
  });

  it("prunes raw events and hourly sketches outside retention, keeping counts", async () => {
    const before = (await q("select sum(transfers + mints + burns)::int n from usdc_hourly")).rows[0].n;
    const cut = new Date(chain.time(anchorAt) * 1000).toISOString();
    const r = (await q("select usdc_index_prune(1::smallint, $1, 1000000) r", [cut])).rows[0].r;
    expect(r.events).toBeGreaterThan(0);
    expect((await q("select count(*)::int n from usdc_transfers where block_time < date_trunc('hour', $1::timestamptz, 'UTC')", [cut])).rows[0].n).toBe(0);
    expect((await q("select sum(transfers + mints + burns)::int n from usdc_hourly")).rows[0].n).toBe(before);
    expect((await q("select count(*)::int n from usdc_hourly where hour < date_trunc('hour', $1::timestamptz, 'UTC') and senders_hll is not null", [cut])).rows[0].n).toBe(0);
  });

  it("keeps the audit trail append-only and functions closed to anon", async () => {
    await expect(q("delete from usdc_ranges")).rejects.toThrow(/append-only/);
    const c = await h.pool.connect();
    try {
      await c.query("set role anon");
      await expect(c.query("select usdc_backfill_claim(1::smallint, '1 minute')")).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("reset role");
      c.release();
    }
    expect(STREAM).toBe(1);
  });
});

// Hourly / daily series (P4-6) over the rollups the indexer wrote above. Runs
// after the indexing tests in this file, against the same real database.
describe("usdc series endpoints on PostgreSQL", () => {
  it("hourly and daily buckets add up exactly to the stored rollups and totals", async () => {
    const { parseSeriesRange, usdcSeries } = await import("../view");
    const span = (await q("select min(hour) lo, max(hour) hi, count(*)::int n from usdc_hourly")).rows[0];
    expect(span.n).toBeGreaterThan(0);
    const hourly = parseSeriesRange("hourly", new Date(span.lo).toISOString(), new Date(new Date(span.hi).getTime() + 3_600_000).toISOString());
    if ("error" in hourly) throw new Error(hourly.error);
    const hs = await usdcSeries("hourly", hourly.from, hourly.to);
    expect(hs.available).toBe(true);
    expect(hs.buckets).toHaveLength(span.n);
    const db = (await q("select sum(transfers)::int t, sum(transfer_raw)::text tr, sum(mints)::int m, sum(burns)::int b from usdc_hourly")).rows[0];
    expect(hs.buckets.reduce((s, x) => s + x.transfers, 0)).toBe(db.t);
    expect(hs.buckets.reduce((s, x) => s + BigInt(x.transferRaw), 0n).toString()).toBe(db.tr);
    expect(hs.buckets.reduce((s, x) => s + x.mints, 0)).toBe(db.m);
    expect(hs.buckets.reduce((s, x) => s + x.burns, 0)).toBe(db.b);
    // Ordered, hour-aligned, sketches decoded.
    for (let i = 1; i < hs.buckets.length; i++) expect(hs.buckets[i].bucket > hs.buckets[i - 1].bucket).toBe(true);
    const sketched = new Set((await q("select hour from usdc_hourly where senders_hll is not null")).rows.map((r) => new Date(r.hour).toISOString()));
    for (const b of hs.buckets) {
      expect(new Date(b.bucket).getUTCMinutes()).toBe(0);
      expect(b.uniqueSenders.method).toBe("hll-p12");
      // A count exactly where a sketch is stored; otherwise null with a note, never a guess.
      if (sketched.has(b.bucket)) expect(b.uniqueSenders.count).toBeGreaterThan(0);
      else expect(b.uniqueSenders).toMatchObject({ count: null, note: expect.any(String) });
    }

    const dspan = (await q("select min(day)::text lo, max(day)::text hi, count(*)::int n from usdc_daily")).rows[0];
    const daily = parseSeriesRange("daily", dspan.lo, new Date(Date.parse(`${dspan.hi}T00:00:00Z`) + 86_400_000).toISOString());
    if ("error" in daily) throw new Error(daily.error);
    const ds = await usdcSeries("daily", daily.from, daily.to);
    expect(ds.buckets).toHaveLength(dspan.n);
    const tot = (await q("select (transfer_raw)::text tr from usdc_totals")).rows[0];
    expect(ds.buckets.reduce((s, x) => s + BigInt(x.transferRaw), 0n).toString()).toBe(tot.tr);
    expect(ds.buckets[0].uniqueSenders.method).toBe("hll-p14");
  });

  it("an empty range is an empty list, never zero-filled buckets", async () => {
    const { usdcSeries } = await import("../view");
    const far = new Date(Date.UTC(2020, 0, 1));
    const s = await usdcSeries("hourly", far, new Date(far.getTime() + 24 * 3_600_000));
    expect(s.buckets).toEqual([]);
    expect(s.available).toBe(true);
  });
});
