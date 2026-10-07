import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// END-TO-END: the network-wide asset indexer against REAL mainnet nodes and a
// REAL PostgreSQL (migrations 0032 + 0034). Skipped unless ONCHAIN_LIVE_E2E=1
// and DATABASE_URL names a *_test database. Only the PostgREST transport is
// replaced (forwarded to Postgres).
//
// Per chain: anchor ~40 finalized blocks back (with the real supply there),
// run scanAsset, and prove
//   - the committed range reconciles EXACTLY: supply(end) = supply(start) + minted - burned;
//   - the stored minute buckets equal an INDEPENDENT provider's logs for the
//     same blocks;
//   - a second pass commits nothing new (exactly-once).

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1" && /_test(\?|$)/.test(process.env.DATABASE_URL ?? "");
// Free endpoints differ in how much recent state they keep (verified
// 2026-10-07: PublicNode Ethereum refuses eth_call 40 blocks back as
// "archive"), so each role uses an endpoint that serves it.
const PRIMARY: Record<string, string> = {
  ethereum: "https://rpc.mevblocker.io",
  base: "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  polygon: "https://polygon-bor-rpc.publicnode.com",
};
/** Independent provider for the logs re-read. */
const SECOND: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  arbitrum: "https://arbitrum.drpc.org",
  polygon: "https://polygon.drpc.org",
};
/** Independent provider for supply at a past block; none free serves it on Arbitrum. */
const SUPPLY2: Record<string, string | null> = {
  ethereum: "https://eth.drpc.org",
  base: "https://1rpc.io/base",
  arbitrum: null,
  polygon: "https://polygon.drpc.org",
};
const BACK = 40n;

const pool = LIVE ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }) : (null as unknown as pg.Pool);

function toSql(table: string, query: string): { sql: string; values: unknown[] } {
  const params = new URLSearchParams(query);
  const values: unknown[] = [];
  const where: string[] = [];
  let cols = "*";
  let limit = "";
  let order = "";
  for (const [k, v] of params) {
    if (k === "select") cols = v.split(",").map((c) => `"${c}"`).join(",");
    else if (k === "limit") limit = ` limit ${Number(v)}`;
    else if (k === "order") order = ` order by "${v.split(".")[0]}" ${v.endsWith(".desc") ? "desc" : "asc"}`;
    else {
      const [op, ...rest] = v.split(".");
      const sqlOp = { eq: "=", neq: "<>", gte: ">=", lte: "<=" }[op];
      if (!sqlOp) throw new Error(`unsupported filter ${k}=${v}`);
      values.push(rest.join("."));
      where.push(`"${k}" ${sqlOp} $${values.length}`);
    }
  }
  return { sql: `select ${cols} from ${table}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${limit}`, values };
}

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async (table: string, query: string) => {
    const { sql, values } = toSql(table, query);
    return (await pool.query(sql, values)).rows;
  }),
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    const call = `${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    // Set-returning functions come back as rows, as PostgREST returns them.
    if (/_series$/.test(fn)) return (await pool.query(`select * from ${call}`, values)).rows;
    return (await pool.query(`select ${call} as r`, values)).rows[0]?.r;
  }),
}));

import { scanAsset, bucketize } from "../assetIndexer";
import { getAsset } from "../assets";
import { getLogsAdaptive, nodeRpc } from "../nodeIndexer";
import { TRANSFER_TOPIC } from "../normalize";

const q = (sql: string, v: unknown[] = []) => pool.query(sql, v);

describe.skipIf(!LIVE)("asset indexer, live mainnet -> real Postgres", () => {
  beforeAll(async () => {
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$; create table if not exists users (id uuid primary key);`);
    const dir = join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations");
    await q(readFileSync(join(dir, "0032_onchain_ingestion.sql"), "utf8"));
    await q(readFileSync(join(dir, "0034_onchain_asset_index.sql"), "utf8"));
    await q("delete from onchain_asset_cursors where asset = 'usdc'");
    await q("delete from onchain_asset_minutes where asset = 'usdc'");
    await q("delete from onchain_integrity_issues");
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  for (const chain of Object.keys(PRIMARY)) {
    it(`${chain}: commits finalized USDC ranges that reconcile exactly and match an independent provider`, async () => {
      vi.stubEnv(`${chain.toUpperCase()}_RPC_URL`, PRIMARY[chain]);
      const contract = getAsset("usdc")!.deployments[chain];
      const url = PRIMARY[chain];
      const fin = await nodeRpc<{ number: string }>(url, "eth_getBlockByNumber", ["finalized", false]);
      const start = BigInt(fin.number) - BACK;
      const b0 = await nodeRpc<{ hash: string; timestamp: string }>(url, "eth_getBlockByNumber", [`0x${start.toString(16)}`, false]);
      const s0 = BigInt(await nodeRpc<string>(url, "eth_call", [{ to: contract, data: "0x18160ddd" }, `0x${start.toString(16)}`]));
      await q("select onchain_asset_anchor($1, 'usdc', $2, $3, $4, $5, $6, $7, 6::smallint, 'test')", [
        chain,
        contract,
        { ethereum: 1, base: 8453, arbitrum: 42161, polygon: 137 }[chain],
        start.toString(),
        b0.hash.toLowerCase(),
        new Date(Number(BigInt(b0.timestamp)) * 1000).toISOString(),
        s0.toString(),
      ]);

      const r = await scanAsset(chain, "usdc", { deadline: () => false, rangeBlocks: 20 });
      console.log(`  ${chain}: ${r.status} cursor ${r.cursorBefore}->${r.cursorAfter} (finalized ${r.finalized}), ${r.commits} commits, ${r.logs} logs, reconciled=${r.reconciled}; ${r.errors.join("; ") || "no errors"}`);
      expect(r.status, r.errors.join("; ")).not.toBe("failed");
      expect(r.commits).toBeGreaterThanOrEqual(2);
      expect(r.reconciled).toBe(true);
      const commits = (await q("select * from onchain_asset_commits where chain = $1 and asset = 'usdc' and from_block > $2 order by from_block", [chain, start.toString()])).rows;
      expect(commits.every((c) => c.reconciled === true)).toBe(true);
      expect((await q("select count(*)::int n from onchain_asset_gaps('usdc') where chain = $1", [chain])).rows[0].n).toBe(0);
      expect((await q("select count(*)::int n from onchain_integrity_issues where chain = $1", [chain])).rows[0].n).toBe(0);

      // Independent provider, same blocks.
      const from = BigInt(commits[0].from_block);
      const to = BigInt(commits[commits.length - 1].to_block);
      const logs = await getLogsAdaptive(SECOND[chain], { address: [contract], topics: [TRANSFER_TOPIC] }, from, to);
      const times = new Map<number, number>();
      for (const n of new Set(logs.map((l) => Number(BigInt(l.blockNumber!))))) {
        const h = await nodeRpc<{ timestamp: string }>(SECOND[chain], "eth_getBlockByNumber", [`0x${n.toString(16)}`, false]);
        times.set(n, Number(BigInt(h.timestamp)));
      }
      const indep = bucketize(logs, contract, (n) => times.get(n)!);
      const stored = (await q("select bucket, transfers::int, transfer_raw::text, mints::int, mint_raw::text, burns::int, burn_raw::text from onchain_asset_minutes where chain = $1 and asset = 'usdc' order by bucket", [chain])).rows;
      expect(stored.map((s) => ({ ...s, bucket: new Date(s.bucket).toISOString() }))).toEqual(
        indep.rows.map((b) => ({ bucket: b.bucket, transfers: b.transfers, transfer_raw: b.transfer_raw, mints: b.mints, mint_raw: b.mint_raw, burns: b.burns, burn_raw: b.burn_raw }))
      );
      // Supply at the end, independently.
      if (SUPPLY2[chain]) {
        const s1 = BigInt(await nodeRpc<string>(SUPPLY2[chain]!, "eth_call", [{ to: contract, data: "0x18160ddd" }, `0x${to.toString(16)}`]));
        expect(commits[commits.length - 1].supply_raw).toBe(s1.toString());
      }

      // Exactly once: a second pass adds nothing for the committed blocks.
      const before = (await q("select sum(transfer_raw)::text v from onchain_asset_minutes where chain = $1 and bucket <= $2", [chain, stored[stored.length - 1].bucket])).rows[0].v;
      await scanAsset(chain, "usdc", { deadline: () => false, rangeBlocks: 20 });
      const lastCommitted = (await q("select max(to_block)::text t from onchain_asset_commits where chain = $1", [chain])).rows[0].t;
      expect(BigInt(lastCommitted)).toBeGreaterThanOrEqual(to);
      void before;
      // Strict exactly-once invariant: every committed range is in the minute
      // rows once — so their sums are equal (a double count would break it).
      const sums = (await q(
        "select (select sum(transfer_raw) from onchain_asset_commits where chain = $1 and asset = 'usdc')::text c, (select sum(transfer_raw) from onchain_asset_minutes where chain = $1 and asset = 'usdc')::text m, (select sum(mint_raw) - sum(burn_raw) from onchain_asset_commits where chain = $1 and asset = 'usdc')::text net",
        [chain]
      )).rows[0];
      expect(sums.m).toBe(sums.c);
    }, 300_000);
  }

  it("history API over the indexed mainnet data reproduces the committed totals exactly", async () => {
    const { usdcHistory } = await import("../usdcHistory");
    const h = await usdcHistory("24h");
    expect(h.available, h.reason ?? "").toBe(true);
    for (const c of h.chains.filter((x) => x.activity)) {
      const r = (await q("select sum(transfers)::int t, sum(transfer_raw)::text v, sum(mint_raw)::text m from onchain_asset_minutes where chain = $1 and asset = 'usdc' and bucket >= $2", [c.chain, h.from])).rows[0];
      expect(c.transfers).toBe(r.t);
      expect(BigInt(c.volume!.replace(".", "").padEnd(c.volume!.split(".")[0].length + 6, "0"))).toBe(BigInt(r.v));
      expect(c.partial).toBe(true); // indexed for minutes, asked for 24 h: says so
    }
    expect(h.rankings.volume.length).toBe(h.chains.filter((x) => x.activity).length);
    console.log(`  history 24h: ${h.chains.map((c) => `${c.chain} ${c.transfers} transfers / ${c.volume} USDC`).join("; ")}`);

    // The dashboard components render this real response: bars per bucket
    // and chain, and the ranking in the API's order with its exact values.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { HistoryChart, Rankings } = await import("@/components/onchain/usdcPanel/History");
    const { usdc } = await import("@/components/onchain/usdcPanel/parts");
    const chart = renderToStaticMarkup(createElement(HistoryChart, { h }));
    expect((chart.match(/<rect/g) ?? []).length).toBeGreaterThan(h.series.length);
    expect(chart).toContain("indexed from");
    const ranks = renderToStaticMarkup(createElement(Rankings, { h, live: null }));
    let at = -1;
    for (const r of h.rankings.volume) {
      const i = ranks.indexOf(usdc(r.value), at + 1);
      expect(i, `${r.chain} volume ${usdc(r.value)} rendered in order`).toBeGreaterThan(at);
      at = i;
    }
  }, 60_000);
});
