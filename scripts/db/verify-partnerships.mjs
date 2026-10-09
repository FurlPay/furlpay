// Real multi-connection PostgreSQL verification. Uses an isolated temporary
// cluster only; never accepts a production connection string.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const data = mkdtempSync(join(tmpdir(), "furlpay-partnerships-"));
const port = Number(process.env.PARTNERSHIP_TEST_PORT ?? 54919);
const db = new EmbeddedPostgres({ databaseDir: data, user: "postgres", password: "harness", port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
let pool;
try {
  await db.initialise(); await db.start(); await db.createDatabase("partnership_test");
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "harness", database: "partnership_test", max: 12 });
  await pool.query("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid'; create function auth.role() returns text language sql as 'select null::text'");
  const dir = join(root, "supabase/migrations");
  // 0049 is self-contained. Hotel migrations need PostGIS, which the embedded
  // binary does not ship; this harness makes no full-migration-chain claim.
  const files = ["0049_partnership_inquiries.sql"];
  for (const f of files) {
    const client = await pool.connect();
    try { await client.query(readFileSync(join(dir, f), "utf8")); }
    catch (error) { await client.query("rollback"); throw new Error(`${f}: ${error.message}`); }
    finally { client.release(); }
  }
  console.log(`PASS migration 0049 applies on ${(await pool.query("show server_version")).rows[0].server_version}`);
  const row = { company_name: "Acme Labs", work_email: "race@acme.example", contact_method: "email", contact_detail: "race@acme.example", partnership_interest: "developer-api", source_page: "partners_hero" };
  const submissions = await Promise.all(Array.from({ length: 8 }, () => pool.query("select * from partnership_inquiry_submit($1::jsonb)", [JSON.stringify(row)]).then(r => r.rows[0])));
  assert.equal(submissions.filter(r => !r.duplicate).length, 1);
  assert.equal(new Set(submissions.map(r => r.id)).size, 1);
  const id = submissions[0].id;
  assert.equal((await pool.query("select count(*)::int n from partnership_inquiries")).rows[0].n, 1);
  console.log("PASS 8 concurrent submissions store exactly one inquiry with one shared ID");
  const changes = await Promise.all(["contacted", "qualified", "declined"].map(to => pool.query("select partnership_inquiry_set_status($1,'new',$2,'admin','review') changed", [id, to]).then(r => r.rows[0].changed)));
  assert.equal(changes.filter(Boolean).length, 1);
  assert.equal((await pool.query("select count(*)::int n from partnership_inquiry_activity")).rows[0].n, 1);
  console.log("PASS concurrent status updates have exactly one winner and one audit record");
  const client = await pool.connect();
  try {
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set role ${role}`);
      for (const sql of ["select * from partnership_inquiries", "select * from partnership_inquiry_activity", "select * from partnership_inquiry_submit('{}')", "select partnership_inquiry_purge(now())", "select partnership_inquiry_set_status(null,'new','closed','x','')"])
        await assert.rejects(client.query(sql), /permission denied/);
      await client.query("reset role");
    }
    await client.query("set role service_role");
    await client.query("insert into partnership_inquiry_activity(inquiry_id,kind,note,actor) values($1,'note','Follow up','admin')", [id]);
    assert.equal((await client.query("select * from partnership_inquiry_activity")).rows.length, 2);
    await client.query("reset role");
  } finally { client.release(); }
  console.log("PASS public access denied and service-role notes work under RLS");
} finally {
  await pool?.end(); await db.stop();
  // Only remove the exact, locally-created temporary cluster.
  if (!resolve(data).startsWith(resolve(tmpdir()) + "/") && !resolve(data).startsWith(resolve(tmpdir()) + "\\")) throw new Error("Unsafe temp path");
  rmSync(data, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
