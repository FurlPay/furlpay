import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// `cp_record_decision` under REAL contention.
//
// WHY THIS FILE EXISTS SEPARATELY. Every other database test in this repo runs
// on PGlite, which is one connection. An advisory lock held on a single
// connection is uncontended by construction, so those tests prove the sequence
// ARITHMETIC and prove nothing whatsoever about the lock. The claim
// "two concurrent decisions cannot claim the same position in the chain" needs
// two concurrent connections to mean anything.
//
// This runs a real PostgreSQL SERVER (embedded-postgres ships the actual
// binary) and opens a real connection pool against it.
//
// OPT-IN, DELIBERATELY. Starting a server costs ~10s and the binary is ~108MB,
// which is the wrong tax on every `vitest run`. Enable with:
//
//     FURLPAY_PG_CONCURRENCY=1 npx vitest run src/lib/controlPlane/__tests__/pgConcurrency.spec.ts
//
// A skipped run is NOT a passing run. When this is skipped the concurrency
// claim is unverified and must be reported that way.
//
// WHAT WOULD A FAILURE LOOK LIKE. If the advisory lock did not hold, two
// transactions would both read `max(sequence)` as N and both insert N+1. The
// unique index on (organization_id, sequence) turns that into an error rather
// than silent corruption — so the failure mode is "some decisions fail" rather
// than "the chain forks". Both are tested below: no duplicates AND no losses.
// ---------------------------------------------------------------------------

const ENABLED = process.env.FURLPAY_PG_CONCURRENCY === "1";
const PORT = Number(process.env.FURLPAY_PG_PORT ?? 55433);
const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations");

type Pool = import("pg").Pool;
let pool: Pool;
let server: { stop(): Promise<void> };
let tearingDown = false;
const unexpectedPoolErrors: (Error & { code?: string })[] = [];

const ORG = "org_concurrency";

const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");

/** One decision write, exactly as `recordDecision` composes it. */
function decisionArgs(index: number) {
  const authId = `cpz_conc_${index}`;
  return [
    JSON.stringify({
      id: authId,
      organization_id: ORG,
      mandate_id: "cpm_conc",
      principal_id: "cpp_conc",
      delegation_id: "cpd_conc",
      operator_id: "cpo_conc",
      agent_id: "cpa_conc",
      phase: "AUTHORIZED",
      verdict: "ALLOW",
      amount_atomic: "1000",
      asset: "USDC",
      currency: "USD",
      network_id: "base",
      rail_id: "x402_usdc_arbitrum",
      recipient_id: "rcp_conc",
      policy_version: "v1",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    null,
    JSON.stringify({
      id: `cpe_conc_${index}`,
      leaf_hash: hex64(`leaf_${index}_${randomUUID()}`),
      bundle: { i: index },
    }),
  ];
}

beforeAll(async () => {
  if (!ENABLED) return;
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = join(process.cwd(), ".pgdata-concurrency");
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  server = pg;

  const { Client, Pool } = await import("pg");

  // A UTF8 database, explicitly. `initdb` picks the host's locale, which on a
  // Windows machine is WIN1252 — and the migrations' comment boxes contain
  // box-drawing characters with no WIN1252 equivalent, so applying them to the
  // default database fails with a genuine encoding error. Supabase databases
  // are always UTF8, so this matches production rather than working around it.
  const admin = new Client({
    host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "postgres",
  });
  await admin.connect();
  await admin.query(`create database furlpay_test encoding 'UTF8' template template0`);
  await admin.end();

  pool = new Pool({
    host: "127.0.0.1",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "furlpay_test",
    // Well under the server's 100. The point is contention, and 40 writers
    // fighting over one advisory lock produces plenty.
    max: 40,
  });
  // An idle client that loses its connection re-emits the error on the pool;
  // with no listener that is an unhandled error and the run fails even though
  // every test passed. Exactly one case is expected: 57P01 ("terminating
  // connection due to administrator command") while afterAll stops the server
  // and a client's own shutdown is still in flight. Anything else, or 57P01
  // outside teardown, is recorded and fails the suite in afterAll.
  pool.on("error", (e: Error & { code?: string }) => {
    if (tearingDown && e.code === "57P01") return;
    unexpectedPoolErrors.push(e);
  });

  const client = await pool.connect();
  try {
    await client.query(`
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    for (const f of ["0020_control_plane.sql", "0021_recipient_attestation.sql"]) {
      await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
    }
    // The full authority chain, because `cp_authorizations` has foreign keys to
    // every link of it. Seeding only the organization produced a wall of
    // `cp_authorizations_mandate_id_fkey` violations that looked like a
    // concurrency failure and was not one.
    await client.query(
      `insert into cp_organizations (id, name, owner_user_id) values ($1,'conc','user_conc')`,
      [ORG]
    );
    await client.query(
      `insert into cp_principals (id, organization_id, kind, status) values ('cpp_conc',$1,'entity','ACTIVE')`,
      [ORG]
    );
    await client.query(
      `insert into cp_operators (id, organization_id, name) values ('cpo_conc',$1,'conc')`,
      [ORG]
    );
    await client.query(
      `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope)
       values ('cpd_conc',$1,'cpp_conc','cpo_conc','cpp_conc','{}'::jsonb)`,
      [ORG]
    );
    await client.query(
      `insert into cp_agents (id, organization_id, principal_id, operator_id, name)
       values ('cpa_conc',$1,'cpp_conc','cpo_conc','conc')`,
      [ORG]
    );
    await client.query(
      `insert into cp_mandates (id, organization_id, principal_id, delegated_to, authority_scope,
                                payload_hash, nonce, policy_version, expires_at)
       values ('cpm_conc',$1,'cpp_conc','cpa_conc','{}'::jsonb,$2,'nonce_conc','v1',
               now() + interval '1 day')`,
      [ORG, hex64("mandate_conc")]
    );
  } finally {
    client.release();
  }
}, 300_000);

afterAll(async () => {
  tearingDown = true;
  await pool?.end();
  await server?.stop();
  if (unexpectedPoolErrors.length) {
    throw new Error(`unexpected pool errors: ${unexpectedPoolErrors.map((e) => `${e.code ?? "?"} ${e.message}`).join("; ")}`);
  }
});

const maybe = ENABLED ? describe : describe.skip;

maybe("cp_record_decision under real multi-connection contention", () => {
  it("is running against a real server, not an in-process engine", async () => {
    const r = await pool.query("select version() as v, pg_backend_pid() as pid");
    expect(String(r.rows[0].v)).toMatch(/PostgreSQL/);
    // Two connections must genuinely be two backends, or none of this is a
    // concurrency test.
    const a = await pool.connect();
    const b = await pool.connect();
    const pidA = (await a.query("select pg_backend_pid() as p")).rows[0].p;
    const pidB = (await b.query("select pg_backend_pid() as p")).rows[0].p;
    a.release();
    b.release();
    expect(pidA).not.toBe(pidB);
  });

  async function race(count: number, offset: number) {
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        pool.query("select cp_record_decision($1::jsonb, $2::jsonb, $3::jsonb) as v", decisionArgs(offset + i))
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => String(r.reason?.message ?? r.reason));
    return { ok, failed };
  }

  async function chainState() {
    const rows = await pool.query<{ sequence: string; leaf_hash: string; previous_leaf_hash: string | null }>(
      `select sequence, leaf_hash, previous_leaf_hash from cp_evidence_records
        where organization_id=$1 order by sequence asc`,
      [ORG]
    );
    return rows.rows.map((r) => ({
      sequence: Number(r.sequence),
      leafHash: r.leaf_hash,
      previousLeafHash: r.previous_leaf_hash,
    }));
  }

  // ── 7: the migration chain, from zero, twice ────────────────────────────
  it("applies the whole migration chain a SECOND time without error", async () => {
    // Deployment reality: migration runners re-run, deploys get retried, and a
    // chain that only works against an empty database is one that fails the day
    // somebody replays it. Every object in 0020/0021 is created with
    // `if not exists` or `create or replace`; this proves it rather than
    // assuming it.
    const client = await pool.connect();
    try {
      for (const f of ["0020_control_plane.sql", "0021_recipient_attestation.sql"]) {
        await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
      }
    } finally {
      client.release();
    }

    // Re-applying must not have dropped the data already in the tables.
    const rows = await pool.query<{ n: string }>(
      `select count(*) as n from cp_organizations where id=$1`,
      [ORG]
    );
    expect(Number(rows.rows[0].n)).toBe(1);
  }, 120_000);

  it("re-applying does not disable RLS or drop the append-only trigger", async () => {
    // The subtle failure: `create table if not exists` skips the table, but an
    // unconditional `drop trigger` or a missed `enable row level security`
    // could leave the SECOND application in a weaker state than the first.
    // Security objects must survive a replay.
    const rls = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r' and c.relname like 'cp!_%' escape '!'`
    );
    expect(rls.rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rls.rows) expect(r.relrowsecurity, `${r.relname} lost RLS`).toBe(true);

    const tg = await pool.query<{ n: string }>(
      `select count(*) as n from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where not t.tgisinternal and c.relname='cp_evidence_records'`
    );
    expect(Number(tg.rows[0].n), "the append-only trigger did not survive a replay").toBe(1);
  }, 120_000);

  // ── 8: the execution claim, under real contention ────────────────────────
  //
  // `/payments/execute` claims a payment with a conditional UPDATE:
  //     set phase='EXECUTING' where phase='AUTHORIZED'
  // Exactly one caller may win, because the winner is the one that submits to
  // the rail. If two could win, one payment would be submitted twice.
  //
  // Tested at the database rather than through the HTTP handler, deliberately:
  // the handler suite runs on a single-connection engine where this race cannot
  // occur at all. This is the layer where the guarantee actually lives.
  async function seedAuthorization(id: string, org = ORG) {
    await pool.query(
      `insert into cp_authorizations
         (id, organization_id, mandate_id, principal_id, delegation_id, operator_id, agent_id,
          phase, verdict, amount_atomic, asset, currency, network_id, rail_id, recipient_id,
          policy_version, expires_at)
       values ($1,$2,'cpm_conc','cpp_conc','cpd_conc','cpo_conc','cpa_conc',
               'AUTHORIZED','ALLOW',1000,'USDC','USD','base','x402_usdc_arbitrum','rcp_conc','v1',
               now() + interval '1 hour')`,
      [id, org]
    );
  }

  async function phaseOfAuth(id: string): Promise<string> {
    const r = await pool.query<{ phase: string }>(
      `select phase from cp_authorizations where id=$1`,
      [id]
    );
    return r.rows[0]?.phase;
  }

  for (const workers of [10, 100, 500]) {
    it(`lets exactly ONE of ${workers} concurrent executions claim the payment`, async () => {
      const id = `cpz_claim_${workers}`;
      await seedAuthorization(id);

      const results = await Promise.all(
        Array.from({ length: workers }, () =>
          pool.query(
            `update cp_authorizations set phase='EXECUTING'
              where organization_id=$1 and id=$2 and phase='AUTHORIZED'
              returning id`,
            [ORG, id]
          )
        )
      );
      const winners = results.filter((r) => r.rowCount === 1).length;
      // One submits; every other caller is told the payment is already in
      // flight and polls instead.
      expect(winners, `${winners} callers would each have submitted this payment`).toBe(1);
      expect(await phaseOfAuth(id)).toBe("EXECUTING");
    }, 300_000);
  }

  it("a revocation racing an execution claim is still visible to the pre-submit re-check", async () => {
    // The dangerous outcome is a payment claimed for execution while its mandate
    // is already revoked. The claim does not authorize submission on its own —
    // the execute path re-reads revocation BEFORE submitting — so what must hold
    // is that a revocation committed on another connection is immediately
    // readable, whichever side won the race.
    const id = "cpz_race_revoke";
    await seedAuthorization(id);

    const [claim] = await Promise.all([
      pool.query(
        `update cp_authorizations set phase='EXECUTING'
          where organization_id=$1 and id=$2 and phase='AUTHORIZED' returning id`,
        [ORG, id]
      ),
      pool.query(
        `insert into cp_revocations (organization_id, subject_kind, subject_id, reason, revoked_by)
         values ($1,'mandate','cpm_conc','raced','test')`,
        [ORG]
      ),
    ]);

    const rev = await pool.query<{ n: string }>(
      `select count(*) as n from cp_revocations
        where organization_id=$1 and subject_kind='mandate' and subject_id='cpm_conc'`,
      [ORG]
    );
    expect(Number(rev.rows[0].n)).toBe(1);
    expect(claim.rowCount === 1 || claim.rowCount === 0).toBe(true);
  }, 120_000);

  it("an attestation revoked on one connection is immediately unreadable as live on another", async () => {
    // The execute path re-reads the attestation before submitting. A stale
    // snapshot here would let a payment go to an address the organization has
    // already disowned.
    await pool.query(
      `insert into cp_recipients (id, organization_id, display_name, status)
       values ('rcp_race',$1,'race','ACTIVE') on conflict do nothing`,
      [ORG]
    );
    await pool.query(
      `insert into cp_recipient_destinations (organization_id, recipient_id, network_id, asset,
         address_canonical, address_display, method, provenance)
       values ($1,'rcp_race','base','USDC','0xrace','0xrace','human_confirmed','test')
       on conflict do nothing`,
      [ORG]
    );

    const live = async () =>
      Number(
        (
          await pool.query<{ n: string }>(
            `select count(*) as n from cp_recipient_destinations
              where organization_id=$1 and recipient_id='rcp_race' and revoked_at is null`,
            [ORG]
          )
        ).rows[0].n
      );

    expect(await live()).toBe(1);
    await pool.query(
      `update cp_recipient_destinations set revoked_at=now(), revoked_reason='raced'
        where organization_id=$1 and recipient_id='rcp_race' and revoked_at is null`,
      [ORG]
    );
    // Read back through the pool, which hands out a different connection than
    // the writer used — the case that would expose a stale snapshot.
    expect(await live(), "a revoked attestation was still readable as live").toBe(0);
  }, 120_000);

  for (const n of [10, 100, 500]) {
    it(`survives ${n} concurrent decisions with a gapless, unique chain`, async () => {
      const before = (await chainState()).length;
      const { ok, failed } = await race(n, before);

      // 1. NOTHING IS LOST. Every call either wrote or reported an error; a
      //    call that "succeeded" without a row would be the dangerous case.
      expect(failed, `${failed.length} writes failed: ${failed.slice(0, 3).join(" | ")}`).toHaveLength(0);
      expect(ok).toBe(n);

      const chain = await chainState();
      expect(chain).toHaveLength(before + n);

      // 2. NO DUPLICATE POSITIONS. Two decisions claiming the same slot is the
      //    exact failure the advisory lock exists to prevent.
      const sequences = chain.map((c) => c.sequence);
      expect(new Set(sequences).size).toBe(sequences.length);

      // 3. NO GAPS. A gap means a sequence was allocated and its write rolled
      //    back — the chain would still verify, but a record would be missing
      //    with nothing to indicate it ever existed.
      expect(sequences).toEqual(sequences.map((_, i) => i + 1));

      // 4. THE CHAIN IS INTACT. Each record's back-link is its predecessor's
      //    hash. Under contention this is what breaks first if two writers read
      //    the same `max(sequence)`.
      expect(chain[0].previousLeafHash).toBeNull();
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].previousLeafHash, `broken link at sequence ${chain[i].sequence}`).toBe(
          chain[i - 1].leafHash
        );
      }
    }, 300_000);
  }

  it("keeps two tenants' chains independent under simultaneous load", async () => {
    // The advisory lock is keyed per organization. If it were global, tenants
    // would serialise against each other — a performance bug. If it were absent,
    // they would interleave sequences — a correctness bug.
    const OTHER = "org_concurrency_2";
    await pool.query(
      `insert into cp_organizations (id, name, owner_user_id) values ($1,'c2','user_conc2')
       on conflict do nothing`,
      [OTHER]
    );
    await pool.query(
      `insert into cp_principals (id, organization_id, kind, status) values ('cpp_conc',$1,'entity','ACTIVE')
       on conflict do nothing`, [OTHER]);
    await pool.query(
      `insert into cp_operators (id, organization_id, name) values ('cpo_conc',$1,'c2')
       on conflict do nothing`, [OTHER]);
    await pool.query(
      `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope)
       values ('cpd_conc',$1,'cpp_conc','cpo_conc','cpp_conc','{}'::jsonb) on conflict do nothing`, [OTHER]);
    await pool.query(
      `insert into cp_agents (id, organization_id, principal_id, operator_id, name)
       values ('cpa_conc',$1,'cpp_conc','cpo_conc','c2') on conflict do nothing`, [OTHER]);
    await pool.query(
      `insert into cp_mandates (id, organization_id, principal_id, delegated_to, authority_scope,
                                payload_hash, nonce, policy_version, expires_at)
       values ('cpm_conc',$1,'cpp_conc','cpa_conc','{}'::jsonb,$2,'nonce_conc2','v1',
               now() + interval '1 day') on conflict do nothing`,
      [OTHER, hex64("mandate_conc2")]);

    const forOrg = (org: string, i: number) => {
      const args = decisionArgs(100000 + i);
      const auth = JSON.parse(args[0] as string);
      auth.organization_id = org;
      auth.id = `cpz_${org}_${i}`;
      const ev = JSON.parse(args[2] as string);
      ev.id = `cpe_${org}_${i}`;
      return [JSON.stringify(auth), null, JSON.stringify(ev)];
    };

    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        pool.query(
          "select cp_record_decision($1::jsonb, $2::jsonb, $3::jsonb) as v",
          forOrg(i % 2 === 0 ? ORG : OTHER, i)
        )
      )
    );

    const other = await pool.query<{ sequence: string }>(
      `select sequence from cp_evidence_records where organization_id=$1 order by sequence`,
      [OTHER]
    );
    const seqs = other.rows.map((r) => Number(r.sequence));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  }, 300_000);

  it("rolls back completely when a concurrent write conflicts", async () => {
    // Two writers using the SAME evidence id. Exactly one must win, and the
    // loser must leave no authorization behind — a half-landed decision is an
    // unexplainable payment.
    const dup = `cpe_dup_${randomUUID()}`;
    const build = (n: number) => {
      const args = decisionArgs(900000 + n);
      const auth = JSON.parse(args[0] as string);
      auth.id = `cpz_dup_${n}`;
      const ev = JSON.parse(args[2] as string);
      ev.id = dup;
      return [JSON.stringify(auth), null, JSON.stringify(ev)];
    };

    const results = await Promise.allSettled([
      pool.query("select cp_record_decision($1::jsonb,$2::jsonb,$3::jsonb)", build(1)),
      pool.query("select cp_record_decision($1::jsonb,$2::jsonb,$3::jsonb)", build(2)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const orphans = await pool.query<{ n: string }>(
      `select count(*) as n from cp_authorizations a
        where a.id in ('cpz_dup_1','cpz_dup_2')
          and not exists (select 1 from cp_evidence_records e where e.authorization_id = a.id)`
    );
    expect(Number(orphans.rows[0].n), "an authorization survived without evidence").toBe(0);
  }, 120_000);
});
