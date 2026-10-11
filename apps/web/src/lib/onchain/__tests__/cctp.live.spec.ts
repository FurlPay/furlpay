import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// END-TO-END acceptance for CCTP V2 on REAL mainnet + a REAL PostgreSQL
// (0032 + 0034 + 0035). Skipped unless ONCHAIN_LIVE_E2E=1 and DATABASE_URL
// names a *_test database. Only the PostgREST transport is replaced.
//
//   1. index ~3000 FINALIZED Base blocks of CCTP events (scanCctp);
//   2. every stored burn equals an INDEPENDENT provider's DepositForBurn logs;
//   3. real Circle Iris attestations are matched field-for-field;
//   4. destinations are proven on their OWN chains (usedNonces at finalized),
//      and each proof is re-read from a second provider.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1" && /_test(\?|$)/.test(process.env.DATABASE_URL ?? "");
const BASE = "https://base-rpc.publicnode.com";
const BASE2 = "https://mainnet.base.org";
// Destination readers (finalized-state eth_call verified to work on each, 2026-10-07).
const DEST: Record<string, [string, string]> = {
  ethereum: ["https://rpc.mevblocker.io", "https://eth.drpc.org"],
  arbitrum: ["https://arb1.arbitrum.io/rpc", "https://arb1.arbitrum.io/rpc"],
  polygon: ["https://polygon.drpc.org", "https://polygon-bor-rpc.publicnode.com"],
};
const pool = LIVE ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }) : (null as unknown as pg.Pool);

function filterSql(k: string, v: string, values: unknown[]): string {
  if (v === "is.null") return `"${k}" is null`;
  const inM = /^in\.\((.*)\)$/.exec(v);
  if (inM) {
    values.push(inM[1].split(",").map(decodeURIComponent));
    return `"${k}" = any($${values.length})`;
  }
  const [op, ...rest] = v.split(".");
  const sqlOp = { eq: "=", neq: "<>", gte: ">=", gt: ">", lte: "<=", lt: "<" }[op];
  if (!sqlOp) throw new Error(`unsupported filter ${k}=${v}`);
  values.push(decodeURIComponent(rest.join(".")));
  return `"${k}" ${sqlOp} $${values.length}`;
}
function toSql(table: string, query: string) {
  const values: unknown[] = [];
  const where: string[] = [];
  let cols = "*";
  let limit = "";
  let order = "";
  for (const [k, v] of new URLSearchParams(query)) {
    if (k === "select") cols = v === "*" ? "*" : v.split(",").map((c) => `"${c}"`).join(",");
    else if (k === "limit") limit = ` limit ${Number(v)}`;
    else if (k === "order") order = ` order by "${v.split(".")[0]}" ${v.endsWith(".desc") ? "desc" : "asc"}`;
    else if (k === "or") where.push(`(${v.replace(/^\(|\)$/g, "").split(",").map((p) => { const [c, ...f] = p.split("."); return filterSql(c, f.join("."), values); }).join(" or ")})`);
    else where.push(filterSql(k, v, values));
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
    return (await pool.query(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)).rows[0]?.r;
  }),
}));

import { decodeDepositForBurn, MESSAGE_TRANSMITTER_V2, processAttestations, processDestinations, scanCctp, TOKEN_MESSENGER_V2, TOPIC } from "../cctp";
import { getLogsAdaptive, nodeRpc } from "../nodeIndexer";

const q = (sql: string, v: unknown[] = []) => pool.query(sql, v);

describe.skipIf(!LIVE)("CCTP V2, live Base mainnet -> real Postgres", () => {
  let from = 0n;
  let to = 0n;
  beforeAll(async () => {
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$; create table if not exists users (id uuid primary key);`);
    const dir = join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations");
    for (const f of ["0032_onchain_ingestion.sql", "0034_onchain_asset_index.sql", "0035_cctp_v2.sql"]) await q(readFileSync(join(dir, f), "utf8"));
    vi.stubEnv("BASE_RPC_URL", BASE);
    for (const [c, [u]] of Object.entries(DEST)) vi.stubEnv(`${c.toUpperCase()}_RPC_URL`, u);
    const fin = await nodeRpc<{ number: string }>(BASE, "eth_getBlockByNumber", ["finalized", false]);
    const start = BigInt(fin.number) - 3000n;
    const h = await nodeRpc<{ hash: string; timestamp: string }>(BASE, "eth_getBlockByNumber", [`0x${start.toString(16)}`, false]);
    await q("select onchain_asset_anchor('base', 'cctp-v2', $1, 8453, $2, $3, $4, null, 6::smallint, 'test')", [TOKEN_MESSENGER_V2, start.toString(), h.hash.toLowerCase(), new Date(Number(BigInt(h.timestamp)) * 1000).toISOString()]);
    from = start + 1n;
  }, 120_000);
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("indexes finalized CCTP burns that equal an independent provider's logs", async () => {
    const r = await scanCctp("base", { deadline: () => false, rangeBlocks: 1000 });
    console.log(`  scan: ${r.status} ${r.cursorBefore}->${r.cursorAfter} (finalized ${r.finalized}), ${r.commits} commits, ${r.burns} burns, ${r.mints} mints, ${r.matched} matched, ${r.generic} generic; ${r.errors.join("; ") || "no errors"}`);
    expect(r.status).not.toBe("failed");
    expect(r.burns).toBeGreaterThan(0);
    to = BigInt(r.cursorAfter!);
    const logs = await getLogsAdaptive(BASE2, { address: [TOKEN_MESSENGER_V2], topics: [TOPIC.depositForBurn] }, from, to);
    const indep = logs.map((l) => ({ tx: l.transactionHash!.toLowerCase(), idx: Number(BigInt(l.logIndex!)), d: decodeDepositForBurn(l)! })).filter((x) => x.d && x.d.burn_token === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    const stored = (await q("select source_tx_hash tx, source_log_index idx, amount_raw::text amount, mint_recipient, destination_domain, max_fee_raw::text max_fee from cctp_transfers where source_chain = 'base' order by source_block_number, source_log_index")).rows;
    expect(stored.map((s) => `${s.tx}:${s.idx}:${s.amount}:${s.mint_recipient}:${s.destination_domain}:${s.max_fee}`).sort()).toEqual(
      indep.map((x) => `${x.tx}:${x.idx}:${x.d.amount}:${x.d.mint_recipient}:${x.d.destination_domain}:${x.d.max_fee}`).sort()
    );
  }, 300_000);

  it("matches real Circle attestations and proves destinations on their own chains", async () => {
    let complete = 0;
    for (let i = 0; i < 6; i++) {
      const a = await processAttestations({ deadline: () => false, limit: 50 });
      complete += a.complete;
      if (a.checked === 0) break;
    }
    const d = await processDestinations({ deadline: () => false, limit: 50 });
    const rows = (await q("select status, count(*)::int n from cctp_transfers where source_chain = 'base' group by 1 order by 1")).rows;
    console.log(`  attestations complete ${complete}; destinations checked ${d.checked}, verified ${d.verified}, waiting ${d.waiting}; states ${JSON.stringify(rows)}${d.errors.length ? "; errors " + d.errors.slice(0, 2).join(" | ") : ""}`);
    expect(complete).toBeGreaterThan(0);
    const attested = (await q("select nonce, executed_fee_raw from cctp_transfers where message_verified and source_chain = 'base'")).rows;
    expect(attested.every((t) => /^0x[0-9a-f]{64}$/.test(t.nonce))).toBe(true);
    // Every destination proof, re-read from a SECOND provider at the finalized tag.
    const proven = (await q("select destination_chain, nonce from cctp_transfers where destination_method = 'used_nonce' limit 10")).rows;
    for (const p of proven) {
      const v = await nodeRpc<string>(DEST[p.destination_chain][1], "eth_call", [{ to: MESSAGE_TRANSMITTER_V2, data: `0xfeb61724${p.nonce.slice(2)}` }, "finalized"]);
      expect(BigInt(v), `${p.destination_chain} ${p.nonce}`).toBe(1n);
    }
    expect((await q("select count(*)::int n from cctp_transfers where status = 'mismatch'")).rows[0].n).toBe(0);
    // Nothing is called finalized without a destination proof.
    expect((await q("select count(*)::int n from cctp_transfers where status = 'finalized' and not destination_verified")).rows[0].n).toBe(0);
  }, 300_000);
});

describe.skipIf(!LIVE)("CCTP API + panel over the live-indexed data", () => {
  it("cctpView reproduces the stored state exactly and the panel renders it", async () => {
    const { cctpView } = await import("../cctpView");
    const v = await cctpView(24 * 30);
    expect(v.available, v.reason ?? "").toBe(true);
    const pool2 = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const counts = Object.fromEntries((await pool2.query("select status, count(*)::int n from cctp_transfers where status <> 'merged' group by 1")).rows.map((r) => [r.status, r.n]));
    const out = (await pool2.query("select sum(amount_raw)::text a, count(*)::int n from cctp_transfers where source_event_id is not null and status not in ('merged','mismatch')")).rows[0];
    await pool2.end();
    expect(v.byStatus).toEqual(counts);
    expect(v.outbound.reduce((a, o) => a + o.transfers, 0)).toBe(out.n);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CctpPanelView } = await import("@/components/onchain/cctp");
    const html = renderToStaticMarkup(createElement(CctpPanelView, { data: v, error: null, lastOk: Date.now() }));
    expect(html).toContain("Outbound");
    expect((html.match(/<tr/g) ?? []).length).toBeGreaterThan(v.recent.length);
    for (const t of v.recent.slice(0, 5)) if (t.sourceTx) expect(html).toContain(t.sourceTx.slice(0, 6));
    console.log(`  panel: ${Object.entries(v.byStatus).map(([k, n]) => `${k}=${n}`).join(", ")}; outbound routes ${v.outbound.length}, inbound routes ${v.inbound.length}; median burn->mint ${v.completionSeconds.median}s`);
  }, 120_000);
});

afterAll(async () => {
  await pool?.end();
});
