#!/usr/bin/env node
// Real-PostgreSQL verification of migration 0027 (analytics) — correctness,
// privileges, idempotency, constraints, and a benchmark at representative
// scale. Runs every migration on an EMPTY throwaway database (refuses anything
// not ending in _test, and any known production ref).
//
//   DATABASE_URL=postgres://…/furlpay_test node scripts/db/verify-analytics.mjs [--scale 1000,10000,100000] [--events 1000000]
//
// Report: FURLPAY_ANALYTICS_REPORT=<path> writes JSON results.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
if (["iyarllmcednkbekweucd", "tvdyfwceiecxwgqhcsge"].some((r) => url.includes(r))) { console.error("Refusing: a hosted project."); process.exit(2); }
if (!new URL(url).pathname.endsWith("_test")) { console.error("Refusing: database name must end in _test."); process.exit(2); }

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const SCALES = arg("--scale", "1000,10000,100000").split(",").map(Number);
const EVENTS = Number(arg("--events", "1000000"));

const pool = new pg.Pool({ connectionString: url, max: 4 });
const q = (t, p) => pool.query(t, p);
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

async function setup() {
  await q(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;`);
  await q("create extension if not exists citext with schema public");
  await q("create extension if not exists pg_trgm with schema public").catch(() => {});
  const applied = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(readFileSync(join(MIG, f), "utf8"));
      await c.query("commit");
      applied.push(f);
    } catch (e) {
      await c.query("rollback");
      if (["0001", "0002", "0003", "0005", "0027"].includes(f.slice(0, 4))) throw new Error(`${f}: ${e.message}`);
    } finally {
      c.release();
    }
  }
  // The harness DB has no grants to service_role on pre-existing tables; give
  // it the same table rights Supabase gives it so SET ROLE tests are meaningful.
  await q("grant usage on schema public to service_role, anon, authenticated");
  await q("grant select on users, audit_log, ops_tx_events, linked_wallets to service_role");
  return applied;
}

const H = 3_600_000, D = 86_400_000;
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ts = (ms) => new Date(ms).toISOString();

async function seedSmall() {
  // Known data: 4 users in the window, 1 before.
  const u = Array.from({ length: 5 }, () => randomUUID());
  const users = [
    [u[0], NOW - 20 * D, "verified"], [u[1], NOW - 6 * D, "verified"], [u[2], NOW - 3 * D, "pending"],
    [u[3], NOW - 2 * D, "unverified"], [u[4], NOW - 1 * D, "verified"],
  ];
  for (const [id, at, k] of users) {
    await q(`insert into users (id, name, email, safe_address, kyc_status, created_at) values ($1,'t',$2,'0x0',$3,$4)`, [id, `${id}@example.test`, k, ts(at)]);
  }
  await q(`insert into linked_wallets (address_norm, user_id, address, proof_nonce) values ($1,$2,$1,'n')`, ["0x" + "a".repeat(40), u[1]]);
  const tx = [
    ["transfers", "settled", 100, 1, "usdc", u[1], NOW - 1 * D],
    ["lifi", "settled", 50, 0.5, "eth", u[1], NOW - 2 * D],
    ["lifi", "settled", 20, 0.2, "eth", u[0], NOW - 2 * D],
    ["transfers", "failed", 999, 0, "usdc", u[2], NOW - 1 * D],
  ];
  for (const [rail, state, amt, fee, tok, uid, at] of tx) {
    await q(`insert into ops_tx_events (id, rail, state, amount_usd, fee_usd, token, user_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`tx_${randomUUID()}`, rail, state, amt, fee, tok, uid, ts(at)]);
  }
  for (const [uid, action, at] of [[u[1], "transfer", NOW - D], [u[1], "auth.login", NOW - D], [u[0], "auth.login", NOW - 2 * D], [u[3], "admin.read", NOW - D]]) {
    await q(`insert into audit_log (user_id, action, created_at) values ($1,$2,$3)`, [uid, action, ts(at)]);
  }
  return u;
}

async function main() {
  const applied = await setup();
  console.log(`analytics harness: ${applied.length} migrations applied (0027 included: ${applied.some((f) => f.startsWith("0027"))})`);
  const u = await seedSmall();
  const from = ts(NOW - 7 * D), to = ts(NOW);

  await check("tx buckets: settled-only volume via the caller, token upper-cased, unit validated", async () => {
    const r = await q(`select token, state, sum(n)::int n, sum(volume_usd)::float v, sum(fee_usd)::float f from analytics_tx_buckets($1,$2,'day') group by 1,2 order by 1,2`, [from, to]);
    const settled = r.rows.filter((x) => x.state === "settled");
    assert.equal(settled.reduce((s, x) => s + x.v, 0), 170);
    assert.ok(Math.abs(settled.reduce((s, x) => s + x.f, 0) - 1.7) < 1e-9);
    assert.deepEqual([...new Set(r.rows.map((x) => x.token))].sort(), ["ETH", "USDC"]);
    const bad = await q(`select count(*)::int n from analytics_tx_buckets($1,$2,'minute')`, [from, to]);
    assert.equal(bad.rows[0].n, 0, "an unknown unit must return nothing, not be coerced");
  });

  await check("rail users: distinct settled users per rail and overall", async () => {
    const r = await q(`select rail, users::int, all_users::int from analytics_rail_users($1,$2) order by rail`, [from, to]);
    assert.deepEqual(r.rows.map((x) => [x.rail, x.users]), [["lifi", 2], ["transfers", 1]]);
    assert.equal(r.rows[0].all_users, 2);
  });

  await check("active users exclude admin.* actions; whole-range distinct is not a sum", async () => {
    const r = await q(`select bucket, users::int from analytics_active_users($1,$2,'day')`, [from, to]);
    const total = r.rows.find((x) => x.bucket === null).users;
    assert.equal(total, 2, "u1 and u0; u3 only did admin.read");
  });

  await check("signup cohort: KYC, wallet and first-transaction stages", async () => {
    const r = await q(`select sum(signups)::int s, sum(kyc_started)::int ks, sum(kyc_verified)::int kv, sum(wallet_linked)::int w, sum(transacted)::int t from analytics_signup_cohort($1,$2,'day')`, [from, to]);
    assert.deepEqual(r.rows[0], { s: 4, ks: 3, kv: 2, w: 1, t: 1 });
  });

  await check("signup starts link to completions by subject", async () => {
    const s1 = "a".repeat(64), s2 = "b".repeat(64);
    await q(`insert into analytics_events (event_id, event_name, subject, created_at, actor_type, user_id) values
      ('signup_started:${s1}:d1','signup_started',$1,$3,'anonymous',null), ('signup_started:${s2}:d1','signup_started',$2,$3,'anonymous',null),
      ('signup_completed:${u[4]}','signup_completed',$1,$4,'user',$5)`, [s1, s2, ts(NOW - 2 * D), ts(NOW - D), u[4]]);
    const r = await q(`select started::int, completed::int from analytics_signup_starts($1,$2)`, [from, to]);
    assert.deepEqual(r.rows[0], { started: 2, completed: 1 });
  });

  await check("idempotent: the same event_id twice is one row", async () => {
    const id = `login:${u[1]}:2026-10-01`;
    for (let i = 0; i < 2; i++) await q(`insert into analytics_events (event_id, event_name, user_id) values ($1,'login',$2) on conflict (event_id) do nothing`, [id, u[1]]);
    const r = await q(`select count(*)::int n from analytics_events where event_id = $1`, [id]);
    assert.equal(r.rows[0].n, 1);
  });

  await check("constraints refuse unknown events, bad subjects, oversized metadata", async () => {
    for (const [sql, p] of [
      [`insert into analytics_events (event_id, event_name, actor_type) values ('x_00000001','page_view_spam','system')`, []],
      [`insert into analytics_events (event_id, event_name, subject, actor_type) values ('x_00000002','login','alice@example.com','system')`, []],
      [`insert into analytics_events (event_id, event_name, metadata, actor_type) values ('x_00000003','login',$1,'system')`, [JSON.stringify({ blob: "x".repeat(4000) })]],
    ]) {
      await assert.rejects(q(sql, p));
    }
  });

  await check("privileges: anon/authenticated can neither read events nor run aggregations; service_role can", async () => {
    const c = await pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await c.query(`set role ${role}`);
        await assert.rejects(c.query("select 1 from analytics_events limit 1"), /permission denied/);
        await assert.rejects(c.query(`select * from analytics_tx_buckets(now() - interval '1 day', now(), 'day')`), /permission denied/);
        await c.query("reset role");
      }
      await c.query("set role service_role");
      await c.query("select count(*) from analytics_events");
      await c.query(`select * from analytics_tx_buckets(now() - interval '1 day', now(), 'day')`);
      await c.query("reset role");
      const rls = await c.query(`select relrowsecurity from pg_class where relname = 'analytics_events'`);
      assert.equal(rls.rows[0].relrowsecurity, true);
    } finally {
      await c.query("reset role").catch(() => {});
      c.release();
    }
  });

  await check("retention purge deletes only older events", async () => {
    await q(`insert into analytics_events (event_id, event_name, created_at, actor_type) values ('old_00000001','logout', now() - interval '500 days', 'system')`);
    const r = await q(`select purge_analytics_events(now() - interval '400 days')::int n`);
    assert.equal(r.rows[0].n, 1);
  });

  // ── 0028: cross-platform client events ─────────────────────────────────────
  const ins = (cols) => {
    const keys = Object.keys(cols);
    return q(`insert into analytics_events (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(cols));
  };
  const cid = () => `c:${randomUUID().replace(/-/g, "")}`;

  await check("0028: a CLIENT may not record a financial or KYC completion", async () => {
    for (const name of ["payment_completed", "cashback_claimed", "kyc_completed", "signup_completed", "transaction_settled"]) {
      await assert.rejects(ins({ event_id: cid(), event_name: name, source: "client", platform: "android", actor_type: "user", user_id: u[1] }), undefined, name);
    }
    await ins({ event_id: cid(), event_name: "screen_viewed", source: "client", platform: "android", actor_type: "user", user_id: u[1], screen: "Wallet", app_version: "2.3.0", build_number: "7" });
  });

  await check("0028: actor and identity must agree; platform and version formats are closed", async () => {
    await assert.rejects(ins({ event_id: cid(), event_name: "page_viewed", source: "client", platform: "web", actor_type: "user" }), undefined, "user actor without user_id");
    await assert.rejects(ins({ event_id: cid(), event_name: "page_viewed", source: "client", platform: "web", actor_type: "anonymous", user_id: u[1] }), undefined, "anonymous actor with user_id");
    await assert.rejects(ins({ event_id: cid(), event_name: "page_viewed", source: "client", platform: "windows_phone", actor_type: "anonymous" }), undefined, "unknown platform");
    await assert.rejects(ins({ event_id: cid(), event_name: "app_opened", source: "client", platform: "ios", actor_type: "anonymous", app_version: "1.0; drop table" }), undefined, "bad version");
    await assert.rejects(ins({ event_id: cid(), event_name: "screen_viewed", source: "client", platform: "ios", actor_type: "anonymous", screen: "<script>" }), undefined, "bad screen");
  });

  await check("0028: an installation id cannot be moved to another user or platform", async () => {
    const inst = randomUUID();
    const touch = (user, platform) => q(`select analytics_touch_device($1,$2,$3,'2.3.0','7') ok`, [inst, user, platform]).then((r) => r.rows[0].ok);
    assert.equal(await touch(u[1], "android"), true);
    assert.equal(await touch(u[1], "android"), true, "same owner refreshes");
    assert.equal(await touch(u[0], "android"), false, "another user cannot claim it");
    assert.equal(await touch(u[1], "ios"), false, "nor relabel its platform");
    const row = (await q(`select user_id, platform from user_devices where installation_id = $1`, [inst])).rows[0];
    assert.deepEqual(row, { user_id: u[1], platform: "android" });
  });

  await check("0028: one person on web, extension and android is ONE user overall", async () => {
    for (const platform of ["web", "chrome_extension", "android"]) {
      await ins({ event_id: cid(), event_name: "app_opened", source: "client", platform, actor_type: "user", user_id: u[2] });
    }
    const anon = randomUUID();
    await ins({ event_id: cid(), event_name: "page_viewed", source: "client", platform: "web", actor_type: "anonymous", anon_id: anon });
    await ins({ event_id: cid(), event_name: "page_viewed", source: "client", platform: "web", actor_type: "anonymous", anon_id: anon });
    const rows = (await q(`select platform, users::int, anonymous::int, all_users::int from analytics_platforms(now() - interval '1 hour', now() + interval '1 minute')`)).rows;
    const web = rows.find((r) => r.platform === "web");
    assert.equal(web.anonymous, 1, "two views from one anonymous session = 1");
    assert.ok(rows.every((r) => r.all_users === rows[0].all_users));
    const perPlatformSum = rows.reduce((s, r) => s + r.users, 0);
    assert.ok(rows[0].all_users < perPlatformSum, "overall distinct users is not the sum of platforms");
  });

  await check("0028: privileges — user_devices and the new functions are service_role only", async () => {
    const c = await pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await c.query(`set role ${role}`);
        await assert.rejects(c.query("select 1 from user_devices limit 1"), /permission denied/);
        await assert.rejects(c.query("select * from analytics_platforms(now() - interval '1 day', now())"), /permission denied/);
        await assert.rejects(c.query(`select analytics_touch_device(gen_random_uuid(), gen_random_uuid(), 'web', null, null)`), /permission denied/);
        await c.query("reset role");
      }
    } finally {
      await c.query("reset role").catch(() => {});
      c.release();
    }
  });

  // ── Benchmark at scale ─────────────────────────────────────────────────────
  const bench = [];
  for (const scale of SCALES) {
    await q(`insert into users (id, name, email, safe_address, kyc_status, created_at)
             select gen_random_uuid(), 'b', 'b' || g || '-' || $1 || '@bench.test', '0x0',
                    (array['verified','pending','unverified'])[1 + (g % 3)],
                    $2::timestamptz - (g % 90) * interval '1 day' - (g % 24) * interval '1 hour'
               from generate_series(1, $1) g`, [scale - (bench.length ? SCALES[bench.length - 1] : 0), ts(NOW)]);
    await q("analyze users");
    const t = Date.now();
    await q(`select * from analytics_signup_cohort($1,$2,'day')`, [ts(NOW - 90 * D), ts(NOW)]);
    bench.push({ users: scale, signup_cohort_90d_ms: Date.now() - t });
  }
  await q(`insert into ops_tx_events (id, rail, state, amount_usd, fee_usd, token, user_id, created_at)
           select 'b_' || g, (array['transfers','lifi','cctp','x402','mpp'])[1 + (g % 5)],
                  case when g % 10 = 0 then 'failed' else 'settled' end,
                  (g % 500) + 0.5, ((g % 500) + 0.5) / 100, (array['usdc','eth','sol','btc'])[1 + (g % 4)],
                  (select id from users offset (g % 1000) limit 1),
                  $2::timestamptz - (g % (90 * 24)) * interval '1 hour'
             from generate_series(1, $1) g`, [EVENTS, ts(NOW)]).catch(async () => {
    // The correlated user pick is slow at 1M; fall back to null users for the volume benchmark.
    await q(`insert into ops_tx_events (id, rail, state, amount_usd, fee_usd, token, created_at)
             select 'b_' || g, (array['transfers','lifi','cctp','x402','mpp'])[1 + (g % 5)], 'settled', (g % 500) + 0.5, 0.1, 'usdc',
                    $2::timestamptz - (g % (90 * 24)) * interval '1 hour' from generate_series(1, $1) g`, [EVENTS, ts(NOW)]);
  });
  await q(`insert into audit_log (user_id, action, created_at)
           select u.id, 'auth.login', $1::timestamptz - (row_number() over () % 90) * interval '1 day'
             from users u`, [ts(NOW)]);
  await q("analyze ops_tx_events; analyze audit_log");

  const timed = async (label, sql, params) => {
    const t = Date.now();
    const r = await q(sql, params);
    return { label, ms: Date.now() - t, rows: r.rowCount };
  };
  const span = [ts(NOW - 90 * D), ts(NOW)];
  const day30 = [ts(NOW - 30 * D), ts(NOW)];
  const runs = [
    await timed("tx buckets 90d/day (1M events)", `select * from analytics_tx_buckets($1,$2,'day')`, span),
    await timed("tx buckets 24h/hour", `select * from analytics_tx_buckets($1,$2,'hour')`, [ts(NOW - D), ts(NOW)]),
    await timed("rail users 30d", `select * from analytics_rail_users($1,$2)`, day30),
    await timed("active users 30d/day", `select * from analytics_active_users($1,$2,'day')`, day30),
    await timed("signup cohort 30d/day", `select * from analytics_signup_cohort($1,$2,'day')`, day30),
  ];
  const plan = await q(`explain (format text) select * from analytics_tx_buckets($1,$2,'day')`, span);
  await check("benchmark: every aggregation answers in bounded time at 100K users / 1M events", async () => {
    for (const r of runs) assert.ok(r.ms < 15_000, `${r.label} took ${r.ms}ms`);
    return { users: bench, events: EVENTS, runs };
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (process.env.FURLPAY_ANALYTICS_REPORT) {
    writeFileSync(process.env.FURLPAY_ANALYTICS_REPORT, JSON.stringify({ applied, results, bench, runs, plan: plan.rows.map((r) => r["QUERY PLAN"]) }, null, 2));
  }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
