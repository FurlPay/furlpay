import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// A real PostgreSQL engine for the control-plane tests.
//
// WHAT THIS IS. PGlite is PostgreSQL 18 compiled to wasm — the same parser,
// planner, constraint machinery and trigger machinery, running in-process. The
// DDL in `supabase/migrations/0020_control_plane.sql` is executed here, not
// asserted about. That closes the gap the schema contract tests could not: they
// can prove the file *says* `numeric(78,0)`; only Postgres can prove the file
// *applies*, that the append-only trigger actually refuses an UPDATE, and that
// the unique constraints actually fire.
//
// WHY A POSTGREST TRANSLATOR RATHER THAN MOCKING THE STORE. The whole bug class
// this suite exists to catch is "a query that forgot its tenant filter". Mocking
// `store.ts` would delete exactly the code under test. So the store runs for
// real, builds its real PostgREST query string, and this shim translates that
// string into SQL. If a store function ever drops `organization_id=eq.…`, the
// generated SQL loses its WHERE clause and the cross-tenant read SUCCEEDS —
// which is what the isolation tests assert must not happen.
//
// THE TRANSLATOR THROWS ON ANYTHING IT DOES NOT UNDERSTAND. An unrecognised
// operator must never degrade into "no filter": that fails in the direction that
// returns more rows, and would make this harness a source of false confidence.
// Every unsupported construct is a hard error naming the construct.
//
// WHAT IT STILL CANNOT PROVE. PostgREST's own behaviour, Supabase auth
// (`auth.uid()`), the service-role RLS bypass, and true multi-connection
// concurrency — PGlite is a single connection, so an advisory lock is
// uncontended by construction. Those remain external dependencies, and the
// concurrency tests here are labelled for what they are: sequential.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations");

/**
 * Applied in order, as a real deployment would.
 *
 * 0021 references `cp_organizations` and `cp_authorizations` from 0020, so the
 * order is load-bearing rather than cosmetic — and applying them as a sequence
 * is itself worth testing, because a migration that only works against a
 * hand-built schema is a migration that will fail on the day it is run.
 */
const MIGRATIONS = ["0020_control_plane.sql", "0021_recipient_attestation.sql"];

export interface PgHarness {
  db: PGlite;
  /** Raw SQL, for assertions the store has no API for. */
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  restore(): void;
}

class UnsupportedFilter extends Error {
  constructor(what: string) {
    super(
      `The PostgREST translator does not understand ${what}. It refuses rather than ignoring it: ` +
        `an ignored filter returns MORE rows, which is the direction that turns this harness into ` +
        `false confidence. Add explicit support for it in pgHarness.ts.`
    );
    this.name = "UnsupportedFilter";
  }
}

/** Reject anything that is not a plain identifier before it reaches SQL text. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new UnsupportedFilter(`the identifier ${JSON.stringify(name)}`);
  return `"${name}"`;
}

interface Parsed {
  where: string;
  params: unknown[];
  order: string;
  limit: string;
}

/**
 * Translate a PostgREST query string into a WHERE/ORDER/LIMIT fragment.
 *
 * Values are bound as parameters, never interpolated — the store passes
 * caller-supplied ids through `encodeURIComponent`, and a translator that
 * concatenated them would be testing SQL injection into its own harness rather
 * than the behaviour under test.
 */
function parseQuery(query: string, startIndex = 1): Parsed {
  const params: unknown[] = [];
  const clauses: string[] = [];
  let order = "";
  let limit = "";
  let index = startIndex;

  for (const part of query.split("&").filter(Boolean)) {
    const split = part.indexOf("=");
    if (split < 0) throw new UnsupportedFilter(`the fragment ${JSON.stringify(part)}`);
    const key = part.slice(0, split);
    const raw = part.slice(split + 1);

    if (key === "select") continue; // column projection; the tests read whole rows
    if (key === "limit") {
      if (!/^\d+$/.test(raw)) throw new UnsupportedFilter(`the limit ${JSON.stringify(raw)}`);
      limit = ` limit ${raw}`;
      continue;
    }
    if (key === "order") {
      const [col, dir = "asc"] = raw.split(".");
      if (dir !== "asc" && dir !== "desc") throw new UnsupportedFilter(`the sort direction ${JSON.stringify(dir)}`);
      order = ` order by ${ident(col)} ${dir}`;
      continue;
    }

    const opSplit = raw.indexOf(".");
    if (opSplit < 0) throw new UnsupportedFilter(`the filter ${JSON.stringify(part)}`);
    const op = raw.slice(0, opSplit);
    const value = decodeURIComponent(raw.slice(opSplit + 1));

    switch (op) {
      case "eq":
        clauses.push(`${ident(key)} = $${index++}`);
        params.push(value);
        break;
      case "neq":
        clauses.push(`${ident(key)} <> $${index++}`);
        params.push(value);
        break;
      case "gte":
        clauses.push(`${ident(key)} >= $${index++}`);
        params.push(value);
        break;
      case "lte":
        clauses.push(`${ident(key)} <= $${index++}`);
        params.push(value);
        break;
      case "is":
        if (value !== "null") throw new UnsupportedFilter(`is.${value}`);
        clauses.push(`${ident(key)} is null`);
        break;
      case "in": {
        const items = value.replace(/^\(|\)$/g, "").split(",");
        clauses.push(`${ident(key)} = any($${index++})`);
        params.push(items);
        break;
      }
      default:
        throw new UnsupportedFilter(`the operator ${JSON.stringify(op)}`);
    }
  }

  return { where: clauses.length ? ` where ${clauses.join(" and ")}` : "", params, order, limit };
}

/**
 * The unique index whose columns the payload fully covers — the one Postgres
 * would actually conflict on.
 *
 * Picking the WIDEST match rather than the first: a payload that covers both the
 * primary key and a composite identity index should conflict on the identity,
 * because that is the constraint that defines "the same fact" for these tables.
 */
async function conflictTargetFor(
  db: PGlite,
  table: string,
  payloadColumns: readonly string[]
): Promise<string[] | null> {
  const indexes = await db.query<{ cols: string[] }>(
    `select array_agg(a.attname order by k.ord) as cols
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
      where c.relname = $1 and i.indisunique and i.indpred is null
      group by i.indexrelid`,
    [table]
  );
  const usable = indexes.rows
    .map((r) => r.cols)
    .filter((cols) => cols.every((c) => payloadColumns.includes(c)))
    .sort((a, b) => b.length - a.length);
  return usable[0] ?? null;
}

/**
 * Stand up Postgres, apply the control-plane migrations, and point `fetch` at it.
 *
 * Call inside `beforeAll`. `restore()` puts the real `fetch` back.
 */
export async function startPg(): Promise<PgHarness> {
  const db = await PGlite.create();

  // Supabase ships these; PGlite does not. Creating the minimum the migration
  // touches keeps a missing platform object from being read as a schema defect.
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
  `);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  // A hard stop against the worst mistake this file could enable. The shim only
  // intercepts requests whose URL contains `/rest/v1/`, so if a future change
  // ever loads real Supabase credentials into the test process (a `dotenv` call,
  // a setup file), tests would begin writing to whatever project those point at
  // — and the only project configured in this repo's env file is PRODUCTION.
  // Refuse to run rather than find out afterwards.
  const configured = process.env.SUPABASE_URL ?? "";
  if (!configured.includes("pglite.local")) {
    throw new Error(
      `pgHarness refuses to start: SUPABASE_URL is ${JSON.stringify(configured)}, not the ` +
        `harness host. Tests must never be able to reach a real Supabase project.`
    );
  }

  const realFetch = globalThis.fetch;

  const json = (body: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const marker = "/rest/v1/";
    if (!url.includes(marker)) return realFetch(input as RequestInfo, init);

    const path = url.slice(url.indexOf(marker) + marker.length);
    const method = (init?.method ?? "GET").toUpperCase();
    const [target, query = ""] = path.split("?");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    try {
      // ── RPC ────────────────────────────────────────────────────────────
      if (target.startsWith("rpc/")) {
        const fn = target.slice(4);
        if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new UnsupportedFilter(`the function name ${fn}`);
        const exists = await db.query<{ n: number }>(
          "select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=$1",
          [fn]
        );
        // PostgREST answers 404 for an unknown function; store.ts turns that
        // into SupabaseFunctionMissing and falls back. Preserve it, so the
        // migration-absent path stays reachable in tests.
        if (!exists.rows[0].n) return json({ message: "PGRST202" }, 404);

        const args = Object.entries(body ?? {});
        const call = args.map(([name], i) => `${ident(name)} := $${i + 1}`).join(", ");
        const values = args.map(([, v]) => (v === null || typeof v === "object" ? JSON.stringify(v) : v));
        const out = await db.query<{ v: unknown }>(`select ${ident(fn)}(${call}) as v`, values);
        return json(out.rows[0]?.v ?? null);
      }

      const table = ident(target);

      // ── SELECT ─────────────────────────────────────────────────────────
      if (method === "GET") {
        const { where, params, order, limit } = parseQuery(query);
        const out = await db.query(`select * from ${table}${where}${order}${limit}`, params);
        return json(out.rows);
      }

      // ── INSERT / UPSERT ────────────────────────────────────────────────
      //
      // PostgREST turns `Prefer: resolution=merge-duplicates` into
      // `ON CONFLICT DO UPDATE`, setting only the columns actually present in
      // the payload. That last detail is a security property, not a nicety: an
      // upsert that reset every column would clear `revoked_at` and turn
      // "attest again" into a revocation bypass. Reproduced faithfully here so
      // the tests exercise the same semantics production will.
      if (method === "POST") {
        const prefer = new Headers(init?.headers ?? {}).get("Prefer") ?? "";
        const merge = prefer.includes("resolution=merge-duplicates");
        const rows = Array.isArray(body) ? body : [body];
        const inserted: unknown[] = [];
        for (const row of rows) {
          const cols = Object.keys(row);
          // The conflict target is inferred from the table's unique indexes.
          // `ON CONFLICT` with no target would only consider the primary key and
          // would miss the identity index that actually defines a duplicate.
          const conflict = merge ? await conflictTargetFor(db, target, cols) : null;
          const action = !merge
            ? ""
            : conflict
              ? ` on conflict (${conflict.map(ident).join(", ")}) do update set ${cols
                  .filter((c) => !conflict.includes(c))
                  .map((c) => `${ident(c)} = excluded.${ident(c)}`)
                  .join(", ")}`
              : " on conflict do nothing";
          const out = await db.query(
            `insert into ${table} (${cols.map(ident).join(", ")}) values (${cols
              .map((_, i) => `$${i + 1}`)
              .join(", ")})${action} returning *`,
            cols.map((c) => {
              const v = (row as Record<string, unknown>)[c];
              return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
            })
          );
          if (out.rows[0]) inserted.push(out.rows[0]);
        }
        return json(inserted, 201);
      }

      // ── UPDATE ─────────────────────────────────────────────────────────
      if (method === "PATCH") {
        const cols = Object.keys(body as Record<string, unknown>);
        const sets = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ");
        const { where, params } = parseQuery(query, cols.length + 1);
        if (!where) throw new UnsupportedFilter("an UPDATE with no filter");
        const out = await db.query(
          `update ${table} set ${sets}${where} returning *`,
          [
            ...cols.map((c) => {
              const v = (body as Record<string, unknown>)[c];
              return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
            }),
            ...params,
          ]
        );
        return json(out.rows);
      }

      // ── DELETE ─────────────────────────────────────────────────────────
      if (method === "DELETE") {
        const { where, params } = parseQuery(query);
        if (!where) throw new UnsupportedFilter("a DELETE with no filter");
        await db.query(`delete from ${table}${where}`, params);
        return json(null, 204);
      }

      throw new UnsupportedFilter(`the method ${method}`);
    } catch (e) {
      // Surface the Postgres error the way PostgREST does, so store.ts's
      // error handling runs against a realistic shape rather than a throw.
      return json({ message: (e as Error).message, code: (e as { code?: string }).code ?? null }, 400);
    }
  }) as typeof fetch;

  return {
    db,
    sql: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
      (await db.query<T>(text, params)).rows,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}
