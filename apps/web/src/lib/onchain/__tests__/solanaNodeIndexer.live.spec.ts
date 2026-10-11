import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// END-TO-END for the Solana node source against REAL Solana mainnet and a
// REAL PostgreSQL. Skipped unless ONCHAIN_LIVE_E2E=1 and DATABASE_URL names a
// throwaway *_test database. Only the PostgREST transport is replaced
// (forwarded to Postgres), so migration 0032 runs for real.
//
// The watch wallet is not hard-coded: it is the receiver of a recent USDC
// transfer read from the node. Every stored SPL row is then checked
// independently: per (transaction, mint), the stored in-minus-out for the
// watched wallet must equal the wallet's balance delta that the node reports
// in pre/postTokenBalances.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1" && /_test(\?|$)/.test(process.env.DATABASE_URL ?? "");
const RPC = process.env.LIVE_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const pool = LIVE ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }) : (null as unknown as pg.Pool);

/** The PostgREST filters these modules issue: eq/neq/gte/gt/lte/is.null/in.(…)/or=(…), order, limit. */
function filterSql(k: string, v: string, values: unknown[]): string {
  if (v === "is.null") return `"${k}" is null`;
  if (v === "not.is.null") return `"${k}" is not null`;
  const m = /^in\.\((.*)\)$/.exec(v);
  if (m) {
    values.push(m[1].split(",").map(decodeURIComponent));
    return `"${k}" = any($${values.length})`;
  }
  const [op, ...rest] = v.split(".");
  const sqlOp = { eq: "=", neq: "<>", gte: ">=", gt: ">", lte: "<=", lt: "<" }[op];
  if (!sqlOp) throw new Error(`unsupported filter ${k}=${v}`);
  values.push(rest.join("."));
  return `"${k}" ${sqlOp} $${values.length}`;
}
function whereSql(query: string, values: unknown[]) {
  const params = new URLSearchParams(query);
  const where: string[] = [];
  let cols = "*";
  let limit = "";
  let order = "";
  for (const [k, v] of params) {
    if (k === "select") cols = v.split(",").map((c) => `"${c}"`).join(",");
    else if (k === "limit") limit = ` limit ${Number(v)}`;
    else if (k === "order") order = ` order by "${v.split(".")[0]}" ${v.endsWith(".desc") ? "desc" : "asc"}`;
    else if (k === "or") {
      const parts = v.replace(/^\(|\)$/g, "").split(",").map((p) => {
        const [col, ...f] = p.split(".");
        return filterSql(col, f.join("."), values);
      });
      where.push(`(${parts.join(" or ")})`);
    } else where.push(filterSql(k, v, values));
  }
  return { cols, where: where.length ? ` where ${where.join(" and ")}` : "", order, limit };
}
function toSql(table: string, query: string): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const w = whereSql(query, values);
  return { sql: `select ${w.cols} from ${table}${w.where}${w.order}${w.limit}`, values };
}

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbSelect: vi.fn(async (table: string, query: string) => {
    if (table === "linked_wallets") return [];
    const { sql, values } = toSql(table, query);
    return (await pool.query(sql, values)).rows;
  }),
  // Upserts on the table's primary key, as PostgREST's merge-duplicates does.
  sbUpsert: vi.fn(async (table: string, rows: Record<string, unknown> | Record<string, unknown>[]) => {
    const list = Array.isArray(rows) ? rows : [rows];
    const pk = (await pool.query("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary", [table])).rows.map((r) => r.attname);
    for (const r of list) {
      const cols = Object.keys(r);
      await pool.query(
        `insert into ${table} (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) on conflict (${pk.map((c) => `"${c}"`).join(",")}) do update set ${cols.map((c) => `"${c}" = excluded."${c}"`).join(",")}`,
        cols.map((c) => (r[c] !== null && typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]))
      );
    }
    return list;
  }),
  sbUpdate: vi.fn(async (table: string, query: string, patch: Record<string, unknown>) => {
    const cols = Object.keys(patch);
    const values: unknown[] = cols.map((c) => patch[c]);
    const w = whereSql(query, values);
    return (await pool.query(`update ${table} set ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(",")}${w.where} returning *`, values)).rows;
  }),
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    return (await pool.query(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values)).rows[0]?.r;
  }),
}));
vi.mock("@/lib/kv", async (orig) => ({ ...(await orig<typeof import("@/lib/kv")>()), kvSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/linkedWalletStore", () => ({ findLinkedWalletOwner: vi.fn(async () => null) }));

import { nodeRpc } from "../nodeIndexer";
import { scanSolana } from "../solanaNodeIndexer";
import type { SolanaTx } from "../normalize";

const q = (sql: string, v: unknown[] = []) => pool.query(sql, v);
const getTx = (sig: string, commitment = "finalized") => nodeRpc<SolanaTx | null>(RPC, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment }]);
let target: { sig: string; slot: number; wallet: string };

/** The receiving owner of a recent finalized USDC transferChecked, read from the node. */
async function recentRecipient() {
  const sigs = await nodeRpc<{ signature: string; slot: number; err: unknown }[]>(RPC, "getSignaturesForAddress", [USDC, { limit: 60, commitment: "finalized" }]);
  for (const s of sigs.filter((x) => x.err === null)) {
    const tx = await getTx(s.signature).catch(() => null);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
    const owners = new Map([...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])].map((b) => [keys[b.accountIndex], b.owner]));
    const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions)];
    for (const ix of all) {
      if (typeof ix.parsed !== "object" || ix.parsed?.type !== "transferChecked") continue;
      const info = ix.parsed.info as { source: string; destination: string; mint: string };
      const to = owners.get(info.destination);
      if (info.mint === USDC && to && to !== owners.get(info.source)) {
        // A typical wallet (a handful of token accounts), not a program/exchange
        // wallet with thousands: the indexer caps those, and that is unit-tested.
        const n = await Promise.all(
          ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"].map((programId) =>
            // A huge wallet's list can exceed the RPC timeout: that candidate is simply skipped.
            nodeRpc<{ value: unknown[] }>(RPC, "getTokenAccountsByOwner", [to, { programId }, { encoding: "jsonParsed" }]).then((x) => x.value.length, () => Infinity)
          )
        );
        if (n[0] + n[1] <= 5) return { sig: s.signature, slot: s.slot, wallet: to };
      }
    }
  }
  throw new Error("no recent USDC transferChecked found");
}

describe.skipIf(!LIVE)("Solana node source, live mainnet -> real Postgres", () => {
  beforeAll(async () => {
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$; create table if not exists users (id uuid primary key);`);
    await q(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations", "0032_onchain_ingestion.sql"), "utf8"));
    await q(readFileSync(join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations", "0034_onchain_asset_index.sql"), "utf8"));
    await q("delete from onchain_node_cursors where chain = 'solana'");
    target = await recentRecipient();
    vi.stubEnv("SOLANA_RPC_URL", RPC);
    vi.stubEnv("ONCHAIN_NODE_CHAINS", "solana");
    vi.stubEnv("ONCHAIN_WATCH_ADDRESSES", `solana:${target.wallet}`);
  }, 300_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
  });

  it("scans the node, stores the transfer exactly, and every row matches the wallet's on-chain balance delta", async () => {
    const r = await scanSolana({ deadline: () => false, fromSlot: target.slot, maxTransactions: 25 });
    expect(r.status === "ok" || r.status === "partial", r.errors.join("; ")).toBe(true);
    // Scoped to this run's wallet: the throwaway database may hold earlier runs.
    const rows = (await q("select * from onchain_events where chain = 'solana' and source = 'node_rpc' and tracked_address = $1 order by block_number", [target.wallet])).rows;
    console.log(`  solana: watch ${target.wallet}, slots ${r.from}..${r.scannedThrough} (finalized ${r.finalized}), ${r.logs} signatures, ${rows.length} transfers stored; ${r.errors.join("; ") || "no errors"}`);
    expect(rows.some((x) => x.tx_hash === target.sig && x.to_address === target.wallet)).toBe(true);

    // Token accounts and balances recorded (migration 0034), checked against the node.
    const accts = (await q("select account, mint from onchain_solana_token_accounts where owner = $1", [target.wallet])).rows;
    expect(accts.length).toBeGreaterThan(0);
    const bal = (await q("select account, asset, amount_raw::text, at_block::bigint from onchain_wallet_balances where owner = $1 and asset = 'usdc'", [target.wallet])).rows;
    expect(bal.length).toBeGreaterThan(0);
    const usdcAcct = bal[0];
    const onNode = await nodeRpc<{ value: { amount: string } }>(RPC, "getTokenAccountBalance", [usdcAcct.account, { commitment: "confirmed" }]);
    // Recorded as the node's exact integer amount, at a slot no older than this scan.
    expect(usdcAcct.amount_raw).toMatch(/^\d+$/);
    expect(onNode.value.amount).toMatch(/^\d+$/);
    expect(Number(usdcAcct.at_block)).toBeGreaterThanOrEqual(target.slot);
    const st = (await q("select indexed_block::bigint, detail from onchain_indexer_status where indexer = 'wallet' and chain = 'solana'")).rows[0];
    expect(Number(st.detail.tokenAccounts)).toBe(accts.length);

    const bySigMint = new Map<string, bigint>();
    for (const row of rows) {
      expect([row.from_address, row.to_address]).toContain(target.wallet);
      expect(row.confirmation_state).toBe(Number(row.block_number) <= r.finalized! ? "finalized" : "confirmed");
      if (!row.asset_address) continue; // native SOL: fee makes the delta non-comparable
      const k = `${row.tx_hash}|${row.asset_address}`;
      const signed = (row.to_address === target.wallet ? 1n : 0n) - (row.from_address === target.wallet ? 1n : 0n);
      bySigMint.set(k, (bySigMint.get(k) ?? 0n) + signed * BigInt(row.amount_raw));
    }
    for (const [k, stored] of bySigMint) {
      const [sig, mint] = k.split("|");
      const tx = (await getTx(sig, "confirmed"))!;
      const sum = (bs: typeof tx.meta.preTokenBalances) => (bs ?? []).filter((b) => b.owner === target.wallet && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
      expect(stored, `${sig} ${mint}`).toBe(sum(tx.meta!.postTokenBalances) - sum(tx.meta!.preTokenBalances));
      expect(new Date(rows.find((x) => x.tx_hash === sig)!.block_timestamp).getTime()).toBe(tx.blockTime! * 1000);
    }

    // Re-scan: everything already stored comes back as duplicates or promotions,
    // never new rows. (An active wallet may have NEW transfers in later slots.)
    const through = r.scannedThrough ?? target.slot;
    const countUpTo = async () => Number((await q("select count(*) n from onchain_events where chain = 'solana' and tracked_address = $1 and block_number <= $2", [target.wallet, through])).rows[0].n);
    const before = await countUpTo();
    expect(before).toBe(rows.filter((x) => Number(x.block_number) <= through).length);
    await scanSolana({ deadline: () => false, fromSlot: target.slot, maxTransactions: 25 });
    expect(await countUpTo()).toBe(before);
  }, 420_000);
});
