// Durable linked-wallet concurrency proof for migration 0005.
//
// Runs the four required races (A/B/C + cold-instance hydration) against a REAL
// Postgres with migration 0005 applied, using genuinely concurrent connections.
// Intended for CI (a Postgres service) or a local/staging Postgres — NEVER
// production. Reads DATABASE_URL; refuses to run without it.
//
//   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/db/link-wallet-race.mjs
//
// Preconditions: the target DB has the Supabase roles (anon/authenticated/
// service_role), a `users` table with the two test ids, and migration 0005
// applied. In CI, apply 0001+0005 first. Locally this was proven with an
// ephemeral embedded Postgres (2026-07-14): all races passed (exactly one
// owner per wallet, one wallet per user, one row under duplicate submits, and
// cold hydration from get_linked_wallet()).
import pg from "pg";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL required (non-production only)."); process.exit(2); }

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const userA = randomUUID();
const userB = randomUUID();
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };

const pool = new pg.Pool({ connectionString: url, max: 20 });
pool.on("error", () => {});

async function race(ops) {
  return Promise.all(ops.map(async (o) => {
    const cc = await pool.connect();
    try {
      const r = await cc.query("select link_wallet($1,$2,$3,$4) as o", [o.user, o.addr.toLowerCase(), o.addr, "0x" + randomUUID().replace(/-/g, "")]);
      return r.rows[0].o;
    } catch (e) { return "ERROR:" + e.code; } finally { cc.release(); }
  }));
}
const tally = (rs) => rs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});

async function main() {
  const c = await pool.connect();
  await c.query("insert into users(id) values ($1),($2) on conflict do nothing", [userA, userB]);

  await c.query("delete from linked_wallets where user_id=any($1)", [[userA, userB]]);
  let rs = await race([...Array(4)].flatMap(() => [{ user: userA, addr: A }, { user: userB, addr: A }]));
  console.log("Race A:", JSON.stringify(tally(rs)));
  ok((await c.query("select count(*)::int n from linked_wallets where address_norm=$1", [A.toLowerCase()])).rows[0].n === 1, "A: wallet owned by exactly one user");

  await c.query("delete from linked_wallets where user_id=any($1)", [[userA, userB]]);
  rs = await race([...Array(4)].flatMap(() => [{ user: userA, addr: A }, { user: userA, addr: B }]));
  console.log("Race B:", JSON.stringify(tally(rs)));
  ok((await c.query("select count(*)::int n from linked_wallets where user_id=$1", [userA])).rows[0].n === 1, "B: user has exactly one active wallet");

  await c.query("delete from linked_wallets where user_id=any($1)", [[userA, userB]]);
  rs = await race(Array.from({ length: 8 }, () => ({ user: userA, addr: A })));
  console.log("Race C:", JSON.stringify(tally(rs)));
  ok((await c.query("select count(*)::int n from linked_wallets where user_id=$1", [userA])).rows[0].n === 1 && !rs.some((x) => x.startsWith("ERROR")), "C: exactly one row, no errors");

  await c.query("delete from linked_wallets where user_id=any($1)", [[userA, userB]]);
  await c.query("select link_wallet($1,$2,$3,$4)", [userA, A.toLowerCase(), A, "0xn"]);
  const hy = await c.query("select address_norm from get_linked_wallet($1)", [userA]);
  ok(hy.rowCount === 1 && hy.rows[0].address_norm === A.toLowerCase(), "cold-instance hydration from Postgres");

  await c.query("delete from linked_wallets where user_id=any($1)", [[userA, userB]]);
  await c.query("delete from users where id=any($1)", [[userA, userB]]);
  c.release();
  await pool.end();
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
