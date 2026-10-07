import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// END-TO-END against REAL chains and a REAL PostgreSQL. Skipped unless
// ONCHAIN_LIVE_E2E=1 and DATABASE_URL names a throwaway *_test database
// (see scripts/db/README or the harness runner). Nothing is mocked except the
// PostgREST transport: sbSelect/sbRpc are forwarded to Postgres, so the real
// migration 0032 functions run. The chain side is a public JSON-RPC node.
//
// Watch addresses are not hard-coded: each chain's most active recent USDC
// recipient is read from the node itself. Every stored row is then verified
// independently against eth_getTransactionReceipt + the block header.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1" && /_test(\?|$)/.test(process.env.DATABASE_URL ?? "");
const RPC: Record<string, string> = { ethereum: process.env.LIVE_ETHEREUM_RPC ?? "https://ethereum-rpc.publicnode.com", base: process.env.LIVE_BASE_RPC ?? "https://mainnet.base.org" };

const pool = LIVE ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }) : (null as unknown as pg.Pool);

/** Just the PostgREST filters this module issues: eq, neq, gte, lte, (not.)is.null, limit. */
function toSql(table: string, query: string): { sql: string; values: unknown[] } {
  const params = new URLSearchParams(query);
  const values: unknown[] = [];
  const where: string[] = [];
  let cols = "*";
  let limit = "";
  for (const [k, v] of params) {
    if (k === "select") cols = v.split(",").map((c) => `"${c}"`).join(",");
    else if (k === "limit") limit = ` limit ${Number(v)}`;
    else if (v === "not.is.null") where.push(`"${k}" is not null`);
    else if (v === "is.null") where.push(`"${k}" is null`);
    else {
      const [op, ...rest] = v.split(".");
      const sqlOp = { eq: "=", neq: "<>", gte: ">=", lte: "<=", lt: "<", gt: ">" }[op];
      if (!sqlOp) throw new Error(`unsupported filter ${k}=${v}`);
      values.push(rest.join("."));
      where.push(`"${k}" ${sqlOp} $${values.length}`);
    }
  }
  return { sql: `select ${cols} from ${table}${where.length ? ` where ${where.join(" and ")}` : ""}${limit}`, values };
}

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async (table: string, query: string) => {
    if (table === "linked_wallets") return [];
    const { sql, values } = toSql(table, query);
    return (await pool.query(sql, values)).rows;
  }),
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    return (await pool.query(sql, values)).rows[0]?.r;
  }),
}));
vi.mock("@/lib/kv", async (orig) => ({ ...(await orig<typeof import("@/lib/kv")>()), kvSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/linkedWalletStore", () => ({ findLinkedWalletOwner: vi.fn(async () => null) }));

import { getChain } from "@/lib/services/chainRegistry";
import { nodeRpc, scanChain } from "../nodeIndexer";
import { TRANSFER_TOPIC, type RpcLog } from "../normalize";

const usdcOf = (chain: string) => getChain(chain)!.usdc!.native.toLowerCase();
const watch: Record<string, string> = {};
const finalizedAt: Record<string, bigint> = {};
const q = (sql: string, v: unknown[] = []) => pool.query(sql, v);

async function mostActiveRecipient(chain: string): Promise<string> {
  const fin = await nodeRpc<{ number: string }>(RPC[chain], "eth_getBlockByNumber", ["finalized", false]);
  const to = BigInt(fin.number);
  const logs = await nodeRpc<RpcLog[]>(RPC[chain], "eth_getLogs", [{ address: [usdcOf(chain)], topics: [TRANSFER_TOPIC], fromBlock: `0x${(to - 4n).toString(16)}`, toBlock: `0x${to.toString(16)}` }]);
  const n = new Map<string, number>();
  for (const l of logs) n.set(`0x${l.topics[2].slice(26)}`, (n.get(`0x${l.topics[2].slice(26)}`) ?? 0) + 1);
  const best = [...n.entries()].filter(([a]) => a !== "0x0000000000000000000000000000000000000000").sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error(`no USDC transfers on ${chain} in the last 5 finalized blocks`);
  finalizedAt[chain] = to;
  return best[0];
}

function useChain(chain: string) {
  vi.stubEnv("ONCHAIN_NODE_CHAINS", chain);
  vi.stubEnv(`${chain.toUpperCase()}_RPC_URL`, RPC[chain]);
  vi.stubEnv("ONCHAIN_WATCH_ADDRESSES", `${chain}:${watch[chain]}`);
  // Public nodes refuse eth_getLogs without a contract address (verified); a
  // self-hosted node needs no allowlist.
  vi.stubEnv("ONCHAIN_NODE_TOKENS", `${chain}:${usdcOf(chain)}`);
}

describe.skipIf(!LIVE)("direct-to-node source, live chains -> real Postgres", () => {
  beforeAll(async () => {
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$; create table if not exists users (id uuid primary key);`);
    await q(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations", "0032_onchain_ingestion.sql"), "utf8"));
    for (const c of Object.keys(RPC)) watch[c] = await mostActiveRecipient(c);
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  for (const chain of Object.keys(RPC)) {
    it(`${chain}: scans the node, stores exact transfers, and every row matches the chain`, async () => {
      useChain(chain);
      const fin = finalizedAt[chain];
      const r = await scanChain(chain, { deadline: () => false, fromBlock: Number(fin - 4n), maxBlocks: 8 });
      expect(r.status, r.errors.join("; ")).toBe("ok");
      expect(r.logs).toBeGreaterThan(0);
      expect(r.counts.inserted).toBe(r.logs);
      const rows = (await q("select * from onchain_events where chain = $1 and source = 'node_rpc' order by block_number, log_index", [chain])).rows;
      expect(rows.length).toBe(r.logs);
      console.log(`  ${chain}: watch ${watch[chain]}, blocks ${r.from}..${r.to} (finalized ${r.finalized}), ${rows.length} transfers stored`);

      for (const row of rows) {
        // Independent re-read: the receipt's log at this index, and the header.
        const rc = await nodeRpc<{ blockHash: string; blockNumber: string; logs: RpcLog[] }>(RPC[chain], "eth_getTransactionReceipt", [row.tx_hash]);
        const lg = rc.logs.find((l) => Number(BigInt(l.logIndex!)) === row.log_index)!;
        expect(lg.address.toLowerCase()).toBe(usdcOf(chain));
        expect(BigInt(lg.data).toString()).toBe(String(row.amount_raw));
        expect(`0x${lg.topics[1].slice(26)}`).toBe(row.from_address);
        expect(`0x${lg.topics[2].slice(26)}`).toBe(row.to_address);
        expect(rc.blockHash.toLowerCase()).toBe(row.block_hash);
        const hdr = await nodeRpc<{ timestamp: string }>(RPC[chain], "eth_getBlockByNumber", [rc.blockNumber, false]);
        expect(new Date(row.block_timestamp).getTime()).toBe(Number(BigInt(hdr.timestamp)) * 1000);
        expect(row.confirmation_state).toBe(BigInt(row.block_number) <= BigInt(r.finalized!) ? "finalized" : "observed");
        expect(row.asset_symbol).toBe("USDC");
        expect(row.asset_decimals).toBe(6);
        // amount = amount_raw / 10^6 exactly
        expect(BigInt(String(row.amount).replace(".", "").padEnd(String(row.amount).split(".")[0].length + 6, "0"))).toBe(BigInt(row.amount_raw));
        expect([row.from_address, row.to_address]).toContain(watch[chain]);
      }

      // Re-scan: the same events are duplicates (or promotions), never new rows.
      const again = await scanChain(chain, { deadline: () => false, fromBlock: Number(fin - 4n), maxBlocks: 8 });
      expect(again.counts.inserted).toBe(0);
      expect(again.counts.duplicates + again.counts.promoted).toBe(again.logs);
      expect((await q("select count(*)::int n from onchain_events where chain = $1", [chain])).rows[0].n).toBe(rows.length);
    }, 240_000);
  }

  it("ethereum: a second source agreeing is a duplicate; disagreeing on the amount is flagged, not merged", async () => {
    const [row] = (await q("select * from onchain_events where chain = 'ethereum' and confirmation_state = 'finalized' order by id limit 1")).rows;
    expect(row).toBeTruthy();
    // A simulated Allium delivery of the SAME on-chain event (merge-rule test).
    const copy = { ...row, source: "allium_beam", confirmation_state: "confirmed", amount_raw: String(row.amount_raw), amount: String(row.amount), block_timestamp: new Date(row.block_timestamp).toISOString() };
    let res = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([copy])])).rows[0].r;
    expect(res.duplicates).toBe(1);
    res = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([{ ...copy, amount_raw: String(BigInt(row.amount_raw) + 1n) }])])).rows[0].r;
    expect(res.conflicts).toBe(1);
    const after = (await q("select * from onchain_events where event_key = $1", [row.event_key])).rows[0];
    expect(String(after.amount_raw)).toBe(String(row.amount_raw));
    expect(after.reconciliation_required).toBe(true);
  });

  it("ethereum: an event the chain does not contain is PROVEN orphaned by the node and cannot come back", async () => {
    useChain("ethereum");
    const fin = finalizedAt.ethereum;
    const ghostTx = "0x" + "5e".repeat(32); // not a real transaction
    const ghost = {
      event_key: `ethereum:${ghostTx}:0`, source: "allium_beam", chain: "ethereum", tx_hash: ghostTx, block_number: Number(fin - 2n),
      block_hash: "0x" + "ab".repeat(32), block_timestamp: new Date(Date.now() - 600_000).toISOString(), log_index: 0,
      from_address: "0x" + "11".repeat(20), to_address: watch.ethereum, asset_address: usdcOf("ethereum"), asset_symbol: "USDC", asset_decimals: 6,
      amount_raw: "1", amount: "0.000001", amount_usd: null, activity_type: "transfer", direction: "in", tracked_address: watch.ethereum, scope: "watch", confirmation_state: "confirmed",
    };
    await q("select onchain_ingest($1::jsonb)", [JSON.stringify([ghost])]);
    const r = await scanChain("ethereum", { deadline: () => false, fromBlock: Number(fin - 4n), maxBlocks: 8 });
    expect(r.markedReorged).toBe(1);
    const row = (await q("select confirmation_state, reorg_final from onchain_events where event_key = $1", [ghost.event_key])).rows[0];
    expect(row).toEqual({ confirmation_state: "reorged", reorg_final: true });
    const res = (await q("select onchain_ingest($1::jsonb) r", [JSON.stringify([ghost])])).rows[0].r;
    expect(res.conflicts).toBe(1);
    expect(res.reinstated).toBe(0);
  }, 120_000);

  it("ethereum: cursor anchors at the node's finalized block, then advances by compare-and-set", async () => {
    useChain("ethereum");
    const first = await scanChain("ethereum", { deadline: () => false });
    expect(first.status, first.errors.join("; ")).toBe("ok");
    expect(first.cursorAdvanced).toBe(true);
    const c1 = (await q("select chain_id, last_block from onchain_node_cursors where chain = 'ethereum'")).rows[0];
    expect(Number(c1.chain_id)).toBe(1);
    expect(Number(c1.last_block)).toBe(first.finalized);
    const second = await scanChain("ethereum", { deadline: () => false, maxBlocks: 200 });
    expect(second.status, second.errors.join("; ")).toBe("ok");
    expect(second.from).toBe(Number(c1.last_block) + 1);
    console.log(`  cursor: anchored at ${c1.last_block}; second pass read ${second.from}..${second.to}, ${second.logs} logs, finalized ${second.finalized}, advanced=${second.cursorAdvanced}`);
  }, 240_000);

  it("refuses an endpoint that serves a different chain (real Base node configured as Ethereum)", async () => {
    useChain("ethereum");
    vi.stubEnv("ETHEREUM_RPC_URL", RPC.base);
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/answered chain id 8453, expected 1/);
  }, 60_000);
});
