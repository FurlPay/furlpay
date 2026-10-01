#!/usr/bin/env node
// Financial-effect invariants against a REAL, multi-connection PostgreSQL.
//
//   DATABASE_URL=postgres://.../<name>_test node scripts/db/verify-financial-effects.mjs [--repeat N]
//
// Applies the REAL migration files (not copies) in order, then proves:
//
//   T-W3  20 concurrent deliveries of one effect on 20 independent
//         connections → exactly 1 applied, 19 clean no-ops (no unique-violation
//         escaping), 1 ledger transaction, 1 posting set, 1 balance move.
//   T-W1  effect committed, then the webhook ack "fails" (event marked failed),
//         the provider redelivers, 0022/0024 re-claims the row, the effect is
//         re-attempted → applied=false, still exactly one effect, event ends
//         'processed'.
//   T-W2  no cache layer exists here at all: repeated redeliveries → one effect.
//   0024  same event id + different body cannot re-claim a failed row.
//   T-L2  two independent pools ("instances"), 100 interleaved credits/debits
//         on one account, concurrently, repeated N times → stored balance ==
//         sum of committed deltas == ledger-derived balance, every iteration.
//   +     overdraft rolls back the whole effect (no orphan header); unbalanced
//         postings refused; every committed ledger transaction balances;
//         save_account_children cannot write a balance; function hardening
//         (search_path, EXECUTE grants) is what the migration claims.
//
// NEEDS A THROWAWAY, EMPTY DATABASE. The SECURITY DEFINER functions pin
// search_path to public (as every money function in this repo does), so the
// harness must install into `public` — a side schema would silently test the
// wrong tables. It refuses unless the database name ends in `_test` (or
// FURLPAY_ALLOW_EFFECT_HARNESS=1), the public schema has no ledger yet, and the
// URL does not contain a known production ref.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const PROD_REFS = ["iyarllmcednkbekweucd"];
const repeatIdx = process.argv.indexOf("--repeat");
const REPEAT = repeatIdx > -1 ? Number(process.argv[repeatIdx + 1]) : 10;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
if (PROD_REFS.some((r) => url.includes(r))) {
  console.error("Refusing: DATABASE_URL points at a production project.");
  process.exit(2);
}
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test") && process.env.FURLPAY_ALLOW_EFFECT_HARNESS !== "1") {
  console.error(`Refusing: database "${dbName}" does not end in _test.`);
  process.exit(2);
}

const SCHEMA = "public";
const poolOpts = { connectionString: url, max: 25 };
const poolA = new pg.Pool(poolOpts);
const poolB = new pg.Pool(poolOpts);
const md5hex = (s) => createHash("md5").update(s).digest("hex");
const q = (pool, text, params) => pool.query(text, params);

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) });
    console.log(`  PASS  ${name}${detail ? `  ${JSON.stringify(detail)}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

// Every migration in order. Migrations needing extensions a bare Postgres does
// not ship (postgis) are applied if possible and otherwise recorded as skipped
// — none of the money tables depend on them.
const chain = [];
async function setup() {
  const c = await poolA.connect();
  try {
    await c.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;`);
    const existing = await c.query("select to_regclass('public.ledger_transactions') t");
    if (existing.rows[0].t) throw new Error("target database is not empty (public.ledger_transactions exists) — use a throwaway database");
    await c.query("create extension if not exists citext with schema public");
    await c.query("create extension if not exists pg_trgm with schema public").catch(() => {});
    const files = (await import("node:fs")).readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    for (const f of files) {
      // One transaction per migration, like the Supabase CLI: a failing file
      // leaves nothing half-applied behind it.
      await c.query("begin");
      try {
        await c.query(readFileSync(join(MIG, f), "utf8"));
        await c.query("commit");
        chain.push({ file: f, applied: true });
      } catch (e) {
        await c.query("rollback");
        chain.push({ file: f, applied: false, error: e.message.slice(0, 160) });
      }
    }
    const must = ["0001", "0004", "0009", "0010", "0022", "0024", "0025", "0026"];
    const missing = chain.filter((m) => must.includes(m.file.slice(0, 4)) && !m.applied);
    if (missing.length) throw new Error(`required migrations failed: ${JSON.stringify(missing)}`);
    await c.query(
      "insert into ledger_accounts (id, code, name, type, currency) values ('acct_1000','1000','Bank / PA escrow','asset','USD') on conflict do nothing"
    );
  } finally {
    c.release();
  }
}

async function newUser() {
  const id = randomUUID();
  await q(poolA, "insert into users (id, email, name, safe_address) values ($1, $2, 'harness', $3)", [id, `${id}@fx.test`, 'fixture-not-an-address']);
  const liab = `acct_2000_${id}`;
  await q(poolA, "insert into ledger_accounts (id, code, name, type, currency) values ($1,$2,'liab','liability','USD')", [liab, `2000:${id}`]);
  return { id, liab };
}

// "in": Dr escrow / Cr customer liability, plus a USDC balance delta.
function effectArgs(key, user, cents, direction = "in") {
  const amount = (cents / 100).toFixed(2);
  const postings =
    direction === "in"
      ? [
          { account_id: "acct_1000", side: "debit", amount: cents },
          { account_id: user.liab, side: "credit", amount: cents },
        ]
      : [
          { account_id: user.liab, side: "debit", amount: cents },
          { account_id: "acct_1000", side: "credit", amount: cents },
        ];
  const sign = direction === "in" ? "" : "-";
  const deltas = [{ user_id: user.id, token: "USDC", chain: "arbitrum", amount: `${sign}${amount}`, usd_value: `${sign}${amount}` }];
  return [key, `harness ${direction} ${amount}`, JSON.stringify(postings), JSON.stringify(deltas)];
}

const APPLY_SQL = "select * from apply_financial_effect($1, $2, $3::jsonb, $4::jsonb, $5, $6)";
async function apply(client, args, provider = null, eventId = null) {
  return (await client.query(APPLY_SQL, [...args, provider, eventId])).rows[0];
}

const balanceCents = async (userId) =>
  Math.round(
    Number(
      (await q(poolA, "select coalesce(sum(amount),0) a from token_balances where user_id=$1 and token='USDC' and chain='arbitrum'", [userId]))
        .rows[0].a
    ) * 100
  );
const ledgerOf = async (liab) => Number((await q(poolA, "select ledger_account_balance($1) b", [liab])).rows[0].b);
const txCount = async (key) => Number((await q(poolA, "select count(*) n from ledger_transactions where external_ref=$1", [key])).rows[0].n);
const legCount = async (key) =>
  Number((await q(poolA, "select count(*) n from ledger_postings where transaction_id=$1", [`lx_${md5hex(key)}`])).rows[0].n);
const eventStatus = async (p, id) =>
  (await q(poolA, "select status from webhook_events where provider=$1 and provider_event_id=$2", [p, id])).rows[0]?.status;

// A REAL start barrier. Lazily-connecting pools serialize "concurrent" calls
// (the first connection finishes before the rest have connected), which made
// an earlier version of this test pass even with the row lock removed. Each
// worker opens a transaction and blocks on a shared advisory lock the test
// holds exclusively; releasing it starts every claim at the same instant.
async function simultaneously(n, work) {
  // The gate is its OWN connection, outside both pools: taking it from a pool
  // that the workers then fill to its max deadlocks the harness (it did).
  if (n > 50) throw new Error("simultaneously(): at most 50 workers (two pools of 25)");
  const gate = new pg.Client({ connectionString: url });
  await gate.connect();
  await gate.query("select pg_advisory_lock(424242)");
  const conns = await Promise.all(Array.from({ length: n }, (_, i) => (i % 2 ? poolB : poolA).connect()));
  try {
    const runs = conns.map(async (c) => {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock_shared(424242)");
      try {
        const r = await work(c);
        await c.query("commit");
        return r;
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    });
    // Give every worker time to reach the barrier, then open it.
    await new Promise((r) => setTimeout(r, 300));
    await gate.query("select pg_advisory_unlock(424242)");
    return await Promise.all(runs);
  } finally {
    conns.forEach((c) => c.release());
    await gate.end();
  }
}


async function main() {
  console.log(`effect harness — schema ${SCHEMA}, repeat ${REPEAT}`);
  await setup();
  console.log(`  migration chain: ${chain.filter((m) => m.applied).length}/${chain.length} applied` +
    (chain.some((m) => !m.applied) ? `; skipped: ${chain.filter((m) => !m.applied).map((m) => m.file).join(", ")}` : ""));

  await check("0025 unique index: UNIQUE (external_ref) WHERE external_ref IS NOT NULL", async () => {
    const r = (await q(poolA, "select indexdef from pg_indexes where schemaname=$1 and indexname='ledger_tx_external_ref_uniq'", [SCHEMA])).rows[0];
    assert.ok(r, "index missing");
    assert.match(r.indexdef, /CREATE UNIQUE INDEX/);
    assert.match(r.indexdef, /\(external_ref\)/);
    assert.match(r.indexdef, /WHERE \(external_ref IS NOT NULL\)/);
    return { indexdef: r.indexdef };
  });

  await check("0025 hardening: SECURITY DEFINER with pinned search_path; EXECUTE only for service_role", async () => {
    const f = (
      await q(poolA,
        `select p.prosecdef, p.proconfig, p.proacl::text acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = $1 and p.proname = 'apply_financial_effect'`, [SCHEMA])
    ).rows[0];
    assert.ok(f, "function missing");
    assert.equal(f.prosecdef, true);
    const sp = (f.proconfig ?? []).find((s) => s.startsWith("search_path="));
    assert.ok(sp, "search_path not pinned");
    assert.match(sp, /pg_temp/, "pg_temp must be listed last so temp objects cannot shadow");
    for (const role of ["anon", "authenticated"]) {
      const can = (await q(poolA, "select has_function_privilege($1, $2, 'execute') ok", [role, `${SCHEMA}.apply_financial_effect(text,text,jsonb,jsonb,text,text)`])).rows[0].ok;
      assert.equal(can, false, `${role} can execute`);
    }
    assert.doesNotMatch(f.acl ?? "", /(^|[{,])=X/, "PUBLIC holds EXECUTE");
    const svc = (await q(poolA, "select has_function_privilege('service_role', $1, 'execute') ok", [`${SCHEMA}.apply_financial_effect(text,text,jsonb,jsonb,text,text)`])).rows[0].ok;
    assert.equal(svc, true);
    return { search_path: sp };
  });

  for (let rep = 0; rep < REPEAT; rep++) {
    const tag = REPEAT > 1 ? ` [${rep + 1}/${REPEAT}]` : "";

    await check(`T-W3: 20 concurrent identical deliveries on 20 connections → one effect${tag}`, async () => {
      const user = await newUser();
      const key = `stripe:pi:pi_${randomUUID()}`;
      const eventId = `evt_${randomUUID()}`;
      await q(poolA, "select * from claim_webhook_event('stripe', $1, 'payment_intent.succeeded', 'h1')", [eventId]);
      const args = effectArgs(key, user, 2500);
      // 20 transactions released at the same instant (start barrier).
      const rows = await simultaneously(20, (c) => apply(c, args, "stripe", eventId));
      const applied = rows.filter((r) => r.applied).length;
      assert.equal(applied, 1, `applied ${applied} times`);
      assert.equal(rows.filter((r) => !r.applied).length, 19);
      assert.ok(rows.every((r) => r.ledger_tx_id === `lx_${md5hex(key)}`), "duplicates must report the original transaction");
      assert.equal(await txCount(key), 1);
      assert.equal(await legCount(key), 2);
      assert.equal(await balanceCents(user.id), 2500);
      assert.equal(await ledgerOf(user.liab), 2500);
      assert.equal(await eventStatus("stripe", eventId), "processed");
    });

    await check(`T-W1: ack fails after commit; redelivery re-claims and retries → one effect${tag}`, async () => {
      const user = await newUser();
      const key = `stripe:pi:pi_${randomUUID()}`;
      const eventId = `evt_${randomUUID()}`;
      assert.equal((await q(poolA, "select * from claim_webhook_event('stripe',$1,'pi.succeeded','h1')", [eventId])).rows[0].claimed, true);
      assert.equal((await apply(poolA, effectArgs(key, user, 1000))).applied, true); // effect commits WITHOUT the ack
      await q(poolA, "select mark_webhook_failed('stripe',$1,'mark_webhook_processed timed out')", [eventId]);
      const reclaim = (await q(poolB, "select * from claim_webhook_event('stripe',$1,'pi.succeeded','h1')", [eventId])).rows[0];
      assert.equal(reclaim.claimed, true, "redelivery must be able to re-claim a failed row");
      const retry = await apply(poolB, effectArgs(key, user, 1000), "stripe", eventId);
      assert.equal(retry.applied, false);
      assert.equal(await txCount(key), 1);
      assert.equal(await legCount(key), 2);
      assert.equal(await balanceCents(user.id), 1000);
      assert.equal(await eventStatus("stripe", eventId), "processed");
    });
  }

  await check("T-W2: no cache layer at all; 5 sequential redeliveries → one effect", async () => {
    const user = await newUser();
    const key = `stripe:pi:pi_${randomUUID()}`;
    const applied = [];
    for (let i = 0; i < 5; i++) applied.push((await apply(i % 2 ? poolB : poolA, effectArgs(key, user, 700))).applied);
    assert.deepEqual(applied, [true, false, false, false, false]);
    assert.equal(await txCount(key), 1);
    assert.equal(await balanceCents(user.id), 700);
  });

  await check("0024: same event id + different body cannot re-claim a failed row", async () => {
    const eventId = `evt_${randomUUID()}`;
    await q(poolA, "select * from claim_webhook_event('stripe',$1,'x','genuine')", [eventId]);
    await q(poolA, "select mark_webhook_failed('stripe',$1,'boom')", [eventId]);
    const forged = (await q(poolA, "select * from claim_webhook_event('stripe',$1,'x','forged')", [eventId])).rows[0];
    assert.equal(forged.claimed, false);
    assert.equal(forged.payload_mismatch, true);
    assert.equal(await eventStatus("stripe", eventId), "failed", "forged body must leave the row for the genuine retry");
    const genuine = (await q(poolA, "select * from claim_webhook_event('stripe',$1,'x','genuine')", [eventId])).rows[0];
    assert.equal(genuine.claimed, true);
  });

  const l2 = { iterations: 0, failures: 0, last: null };
  for (let rep = 0; rep < REPEAT; rep++) {
    await check(`T-L2: two instances, 100 interleaved credits/debits → no lost updates [${rep + 1}/${REPEAT}]`, async () => {
      l2.iterations++;
      const user = await newUser();
      await apply(poolA, effectArgs(`open:${user.id}`, user, 100_000));
      const ops = Array.from({ length: 100 }, (_, i) => ({
        key: `op:${user.id}:${i}`,
        cents: 100 + (((i + rep) * 37) % 900),
        dir: (i + rep) % 3 === 0 ? "out" : "in",
      }));
      // Two rounds of 50 transactions, each round released at the same instant.
      const settled = [];
      for (const round of [ops.slice(0, 50), ops.slice(50)]) {
        let i = 0;
        const res = await simultaneously(round.length, (c) => {
          const op = round[i++];
          return apply(c, effectArgs(op.key, user, op.cents, op.dir));
        }).then((rows) => rows.map((value) => ({ status: "fulfilled", value })), (e) => [{ status: "rejected", reason: e }]);
        settled.push(...res);
      }
      const rejected = settled.filter((s) => s.status === "rejected");
      if (rejected.length) l2.failures++;
      assert.equal(rejected.length, 0, `unexpected failures: ${rejected.map((f) => f.reason?.message).join("; ")}`);
      const expected = 100_000 + ops.reduce((s, o) => s + (o.dir === "in" ? o.cents : -o.cents), 0);
      const actual = await balanceCents(user.id);
      l2.last = { expected, actual, ledger: await ledgerOf(user.liab) };
      assert.equal(actual, expected, `balance ${actual} != ${expected}`);
      assert.equal(l2.last.ledger, expected, "ledger-derived balance disagrees with stored balance");
    });
  }

  // --- cashback (0026) ------------------------------------------------------
  await q(poolA, "insert into ledger_accounts (id, code, name, type, currency) values ('acct_5100','5100','Operational expense','expense','USD') on conflict do nothing");
  const accrue = (pool, id, user, source, minor) =>
    q(pool, "select record_cashback_accrual($1, $2, $3, $4) ok", [id, user.id, source, minor]).then((r) => r.rows[0].ok);
  const claim = (client, user, liab = user.liab) =>
    client.query("select * from claim_cashback($1, $2, 'acct_5100')", [user.id, liab]).then((r) => r.rows[0]);

  await check("cashback: 40 simultaneous claims of the same accruals (barrier) → one payout", async () => {
    const user = await newUser();
    for (const [i, minor] of [[1, 125], [2, 250], [3, 5]]) await accrue(poolA, `acc_${user.id}_${i}`, user, `spend_${i}`, minor);
    const rows = await simultaneously(40, (c) => claim(c, user));
    const paid = rows.filter((r) => r.applied);
    assert.equal(paid.length, 1, `paid ${paid.length} times`);
    assert.equal(Number(paid[0].claimed_minor), 380);
    assert.equal(await balanceCents(user.id), 380);
    assert.equal(await ledgerOf(user.liab), 380);
  });

  await check("cashback: 100 concurrent claims of the same accruals → one payout", async () => {
    const user = await newUser();
    for (const [i, minor] of [[1, 125], [2, 250], [3, 5]]) await accrue(poolA, `acc_${user.id}_${i}`, user, `spend_${i}`, minor);
    const rows = await Promise.all(Array.from({ length: 100 }, (_, i) => claim(i % 2 ? poolB : poolA, user)));
    const paid = rows.filter((r) => r.applied);
    assert.equal(paid.length, 1, `paid ${paid.length} times`);
    assert.equal(Number(paid[0].claimed_minor), 380);
    assert.equal(rows.filter((r) => !r.applied && Number(r.claimed_minor) === 0).length, 99);
    assert.equal(await balanceCents(user.id), 380);
    assert.equal(await ledgerOf(user.liab), 380);
    const unclaimed = Number((await q(poolA, "select count(*) n from cashback_accruals where user_id=$1 and claimed_at is null", [user.id])).rows[0].n);
    assert.equal(unclaimed, 0);
  });

  await check("cashback: 100 sequential retries → one payout; new accruals pay separately", async () => {
    const user = await newUser();
    await accrue(poolA, `acc_${user.id}_a`, user, "spend_a", 100);
    const first = await claim(poolA, user);
    for (let i = 0; i < 99; i++) assert.equal((await claim(poolB, user)).applied, false);
    assert.equal(first.applied, true);
    await accrue(poolA, `acc_${user.id}_b`, user, "spend_b", 40);
    assert.equal(Number((await claim(poolA, user)).claimed_minor), 40);
    assert.equal(await balanceCents(user.id), 140);
  });

  await check("cashback: the same spend cannot accrue twice", async () => {
    const user = await newUser();
    assert.equal(await accrue(poolA, `acc_${user.id}_x`, user, "spend_x", 100), true);
    assert.equal(await accrue(poolA, `acc_${user.id}_y`, user, "spend_x", 100), false);
    assert.equal(Number((await claim(poolA, user)).claimed_minor), 100);
  });

  await check("cashback: a claim pays only the caller's accruals (A never receives B's)", async () => {
    const a = await newUser();
    const b = await newUser();
    await accrue(poolA, `acc_${a.id}`, a, "s", 70);
    await accrue(poolA, `acc_${b.id}`, b, "s", 900);
    const r = await claim(poolA, a);
    assert.equal(Number(r.claimed_minor), 70);
    assert.equal(await balanceCents(a.id), 70);
    assert.equal(await balanceCents(b.id), 0);
    assert.equal(Number((await q(poolA, "select count(*) n from cashback_accruals where user_id=$1 and claimed_at is null", [b.id])).rows[0].n), 1);
  });

  await check("cashback: the payout cannot be directed to another user's liability account", async () => {
    const a = await newUser();
    const b = await newUser();
    await accrue(poolA, `acc_${a.id}_z`, a, "s", 50);
    await assert.rejects(() => claim(poolA, a, b.liab), /does not belong/);
    assert.equal(await balanceCents(b.id), 0);
    assert.equal(Number((await q(poolA, "select count(*) n from cashback_accruals where user_id=$1 and claimed_at is null", [a.id])).rows[0].n), 1);
  });

  await check("cashback: zero/negative accruals are refused", async () => {
    const user = await newUser();
    await assert.rejects(() => accrue(poolA, `acc_${user.id}_neg`, user, "neg", -5), /positive/);
    await assert.rejects(() => accrue(poolA, `acc_${user.id}_zero`, user, "zero", 0), /positive/);
  });

  await check("overdraft rolls back the whole effect (no orphan ledger header)", async () => {
    const user = await newUser();
    const key = `spend:${randomUUID()}`;
    await assert.rejects(() => apply(poolA, effectArgs(key, user, 500, "out")), /insufficient/);
    assert.equal(await txCount(key), 0);
    assert.equal(await balanceCents(user.id), 0);
  });

  await check("unbalanced postings are refused and leave nothing behind", async () => {
    const user = await newUser();
    const key = `bad:${randomUUID()}`;
    const bad = [
      { account_id: "acct_1000", side: "debit", amount: 100 },
      { account_id: user.liab, side: "credit", amount: 99 },
    ];
    await assert.rejects(() => q(poolA, "select * from apply_financial_effect($1,'bad',$2::jsonb,'[]'::jsonb)", [key, JSON.stringify(bad)]), /unbalanced/);
    assert.equal(await txCount(key), 0);
  });

  await check("every committed ledger transaction balances (debits = credits)", async () => {
    const r = await q(poolA, `
      select t.id from ledger_transactions t join ledger_postings p on p.transaction_id = t.id
      group by t.id
      having sum(case when p.side='debit' then p.amount else 0 end) <> sum(case when p.side='credit' then p.amount else 0 end)`);
    assert.equal(r.rowCount, 0, `unbalanced: ${r.rows.map((x) => x.id).join(",")}`);
    const n = Number((await q(poolA, "select count(*) n from ledger_transactions")).rows[0].n);
    return { transactions: n };
  });

  await check("save_account_children can no longer write a balance", async () => {
    const user = await newUser();
    await apply(poolA, effectArgs(`seed:${user.id}`, user, 1234));
    await q(poolA, "select save_account_children($1::uuid, $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)", [
      user.id,
      JSON.stringify([{ token: "USDC", chain: "arbitrum", amount: 999999, usd_value: 999999 }]),
    ]);
    assert.equal(await balanceCents(user.id), 1234);
  });

  await check("furlpay_missing_constraints() knows the 0025 guard and finds it present", async () => {
    const rows = (await q(poolA, "select constraint_name from furlpay_missing_constraints()")).rows.map((r) => r.constraint_name);
    assert.ok(!rows.includes("ledger_tx_external_ref_uniq"));
    const src = (await q(poolA, "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and proname='furlpay_missing_constraints'", [SCHEMA])).rows[0].prosrc;
    assert.ok(src.includes("ledger_tx_external_ref_uniq"));
  });

  results.push({ name: "T-L2 summary", ok: l2.failures === 0, detail: l2 });
}

try {
  await main();
} catch (e) {
  results.push({ name: "setup", ok: false, error: e.message });
  console.error(`setup failed: ${e.message}`);
} finally {
  await poolA.end();
  await poolB.end();
}
const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} passed`);
if (process.env.FURLPAY_EFFECT_REPORT) {
  writeFileSync(process.env.FURLPAY_EFFECT_REPORT, JSON.stringify({ schema: SCHEMA, repeat: REPEAT, chain, results }, null, 2));
}
process.exit(failedCount ? 1 : 0);
