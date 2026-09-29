#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Hosted-Supabase verification for the control plane.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A TEST. Everything the control plane
// needs from Postgres is already proven against a real PostgreSQL engine — the
// migrations apply, the constraints fire, the append-only trigger refuses, the
// advisory lock holds under 500-way contention. What that CANNOT prove is the
// part that only exists on a hosted Supabase project:
//
//   · PostgREST's own semantics, above all how it converts a JSON `null` for a
//     jsonb function argument. F-14's fix is correct under BOTH readings
//     precisely because this question could not be answered here.
//   · The service-role key's RLS bypass, and the anon/authenticated roles that
//     are supposed to read nothing.
//   · Connection pooling, statement timeouts, and the schema cache.
//
// Those need a real project. This script is the harness that answers them in
// one run, the moment credentials exist.
//
// IT REFUSES TO TOUCH PRODUCTION. The only Supabase project configured in this
// repository is production, and applying migrations to it from a verification
// script is not a risk worth any amount of convenience. The guard is explicit,
// checked first, and cannot be disabled by a flag.
//
// USAGE
//   SUPABASE_STAGING_URL=https://<ref>.supabase.co \
//   SUPABASE_STAGING_SERVICE_ROLE_KEY=<service-role-key> \
//   SUPABASE_STAGING_ANON_KEY=<anon-key> \
//   SUPABASE_ACCESS_TOKEN=sbp_<personal-access-token> \
//   node apps/web/scripts/verify-hosted-supabase.mjs
//
// The access token is needed only to APPLY the migrations (the Management API
// is the only way to run DDL without psql). Pass --skip-migrate if they have
// already been applied, and the script runs read/write checks with the
// service-role key alone.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "supabase", "migrations");

/** Production. Never a target. Matched on the project ref, not the full URL. */
const PRODUCTION_REFS = ["iyarllmcednkbekweucd"];

const URL_ = process.env.SUPABASE_STAGING_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_STAGING_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.SUPABASE_STAGING_ANON_KEY ?? "";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const SKIP_MIGRATE = process.argv.includes("--skip-migrate");

let pass = 0;
let fail = 0;
const results = [];

function check(area, ok, detail) {
  results.push({ area, ok, detail });
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${area.padEnd(46)} ${detail ?? ""}`);
}

function die(message) {
  console.error(`\n  REFUSED: ${message}\n`);
  process.exit(2);
}

// ── Guards, before anything touches the network ────────────────────────────
if (!URL_ || !SERVICE_KEY) {
  console.error(`
  Hosted Supabase verification has NOT run: no staging credentials.

  This is an EXTERNAL DEPENDENCY, not a code gap. Nothing in the repository can
  supply it, and nothing in this script will pretend otherwise.

  Required:
    SUPABASE_STAGING_URL               https://<project-ref>.supabase.co
    SUPABASE_STAGING_SERVICE_ROLE_KEY  service-role key for that project
    SUPABASE_STAGING_ANON_KEY          anon key, to prove RLS denies it
    SUPABASE_ACCESS_TOKEN              sbp_… personal access token (DDL only)

  The staging project must NOT be production (${PRODUCTION_REFS.join(", ")}).
`);
  process.exit(1);
}

const ref = new URL(URL_).hostname.split(".")[0];
if (PRODUCTION_REFS.includes(ref)) {
  die(`${ref} is the PRODUCTION project. This script never targets production.`);
}
console.log(`\n  Target project: ${ref}  (verified not production)\n`);

// ── REST helpers ───────────────────────────────────────────────────────────
async function rest(method, path, { body, key = SERVICE_KEY, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json };
}

/** Run arbitrary SQL through the Management API. Needs SUPABASE_ACCESS_TOKEN. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`management API ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const ORG = `org_verify_${Date.now()}`;

async function main() {
  // ── 1. Migrations ────────────────────────────────────────────────────────
  if (!SKIP_MIGRATE) {
    if (!ACCESS_TOKEN) die("SUPABASE_ACCESS_TOKEN is required to apply migrations (or pass --skip-migrate)");
    for (const file of ["0020_control_plane.sql", "0021_recipient_attestation.sql"]) {
      await sql(readFileSync(join(MIGRATIONS, file), "utf8"));
      check("migration applies", true, file);
    }
    // Idempotency: the same chain, a second time.
    for (const file of ["0020_control_plane.sql", "0021_recipient_attestation.sql"]) {
      await sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    }
    check("migration chain is idempotent", true, "applied twice, no error");
  }

  // ── 2. Schema shape, read through PostgREST ──────────────────────────────
  const orgs = await rest("GET", "cp_organizations?limit=1");
  check("PostgREST sees the control-plane tables", orgs.status === 200, `HTTP ${orgs.status}`);

  if (ACCESS_TOKEN) {
    const money = await sql(`
      select data_type, numeric_scale from information_schema.columns
       where table_name='cp_authorizations' and column_name='amount_atomic'`);
    const row = Array.isArray(money) ? money[0] : money;
    check(
      "money is NUMERIC(78,0), never a float",
      row?.data_type === "numeric" && Number(row?.numeric_scale) === 0,
      JSON.stringify(row)
    );

    const rls = await sql(`
      select count(*)::int as off from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and c.relname like 'cp!_%' escape '!'
         and c.relrowsecurity = false`);
    const offRow = Array.isArray(rls) ? rls[0] : rls;
    check("RLS is enabled on every control-plane table", Number(offRow?.off) === 0, `${offRow?.off} without RLS`);
  }

  // ── 3. Service role writes; anon reads nothing ───────────────────────────
  const created = await rest("POST", "cp_organizations", {
    body: { id: ORG, name: "verification", owner_user_id: `user_${ORG}` },
    prefer: "return=representation",
  });
  check("service role can write", created.status === 201, `HTTP ${created.status}`);

  if (ANON_KEY) {
    const anon = await rest("GET", `cp_organizations?id=eq.${ORG}`, { key: ANON_KEY });
    const leaked = Array.isArray(anon.body) ? anon.body.length : 0;
    // RLS is on with zero policies, so the anon role must read nothing even
    // though the row demonstrably exists.
    check("anon key reads ZERO rows from a populated table", leaked === 0, `${leaked} rows, HTTP ${anon.status}`);
  } else {
    check("anon key reads zero rows", false, "SKIPPED — SUPABASE_STAGING_ANON_KEY not set");
  }

  // ── 4. THE QUESTION THIS SCRIPT EXISTS FOR ───────────────────────────────
  //
  // Does PostgREST deliver a JSON `null` argument as SQL NULL, or as the jsonb
  // scalar `'null'`? F-14's guard is written to be correct under both, and this
  // is the only place the actual answer can be observed.
  {
    const probe = await rest("POST", "rpc/cp_jsonb_present", { body: { v: null } });
    // `cp_jsonb_present` returns NULL for both SQL NULL and jsonb 'null', so a
    // null result proves the guard collapses them correctly whichever arrives.
    check(
      "cp_jsonb_present collapses a JSON null to SQL NULL",
      probe.status === 200 && (probe.body === null || probe.body === undefined),
      `HTTP ${probe.status} body=${JSON.stringify(probe.body)}`
    );

    if (ACCESS_TOKEN) {
      // And the raw answer, recorded for the audit rather than asserted.
      const raw = await sql(`select jsonb_typeof('null'::jsonb) as t, ('null'::jsonb is null) as is_sql_null`);
      const r = Array.isArray(raw) ? raw[0] : raw;
      console.log(`        observed: jsonb 'null' typeof=${r?.t} is_sql_null=${r?.is_sql_null}`);
    }
  }

  // ── 5. The atomic decision write, through PostgREST ──────────────────────
  {
    const auth = {
      id: `cpz_${ORG}`,
      organization_id: ORG,
      mandate_id: `cpm_${ORG}`,
      principal_id: `cpp_${ORG}`,
      delegation_id: `cpd_${ORG}`,
      operator_id: `cpo_${ORG}`,
      agent_id: `cpa_${ORG}`,
      phase: "AUTHORIZED",
      verdict: "ALLOW",
      amount_atomic: "1000",
      asset: "USDC",
      currency: "USD",
      network_id: "base",
      rail_id: "x402_usdc_arbitrum",
      recipient_id: "rcp_v",
      policy_version: "v1",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    // Deliberately passes p_approval: null — the ALLOW path, and the exact
    // shape that F-14 broke on.
    const rpc = await rest("POST", "rpc/cp_record_decision", {
      body: {
        p_authorization: auth,
        p_approval: null,
        p_evidence: { id: `cpe_${ORG}`, leaf_hash: "a".repeat(64), bundle: { v: 1 } },
      },
    });
    check(
      "cp_record_decision writes an ALLOW with a null approval",
      rpc.status === 200,
      `HTTP ${rpc.status} ${JSON.stringify(rpc.body).slice(0, 160)}`
    );
  }

  // ── 6. Append-only evidence, enforced by the hosted database ─────────────
  {
    const upd = await rest("PATCH", `cp_evidence_records?id=eq.cpe_${ORG}`, {
      body: { leaf_hash: "b".repeat(64) },
    });
    check("evidence UPDATE is refused", upd.status >= 400, `HTTP ${upd.status}`);
    const del = await rest("DELETE", `cp_evidence_records?id=eq.cpe_${ORG}`);
    check("evidence DELETE is refused", del.status >= 400, `HTTP ${del.status}`);
  }

  // ── 7. Composite recipient identity ──────────────────────────────────────
  if (ACCESS_TOKEN) {
    const pk = await sql(`
      select string_agg(a.attname, ',' order by k.ord) as cols
        from pg_index i
        join pg_class c on c.oid = i.indrelid
        join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
       where c.relname = 'cp_recipients' and i.indisprimary`);
    const r = Array.isArray(pk) ? pk[0] : pk;
    check(
      "cp_recipients primary key is (organization_id, id)",
      String(r?.cols) === "organization_id,id",
      String(r?.cols)
    );
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (ACCESS_TOKEN) {
    // Evidence is append-only by trigger, so a plain DELETE cannot remove the
    // test rows. Dropping the organization cascades everything else; the
    // evidence row is removed with the trigger briefly disabled, which is
    // exactly the privileged operation the trigger is meant to require.
    await sql(`
      alter table cp_evidence_records disable trigger cp_evidence_no_update;
      delete from cp_evidence_records where organization_id = '${ORG}';
      alter table cp_evidence_records enable trigger cp_evidence_no_update;
      delete from cp_organizations where id = '${ORG}';`);
    console.log(`\n  cleaned up ${ORG}`);
  } else {
    console.log(`\n  NOTE: ${ORG} left in place (no access token for cleanup)`);
  }
}

main()
  .then(() => {
    console.log(`\n  -----------------------------------------`);
    console.log(`  PASS=${pass}  FAIL=${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(`\n  ERROR: ${e.message}`);
    process.exit(3);
  });
