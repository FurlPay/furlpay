import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { createServer, type AddressInfo } from "node:net";

// A throwaway embedded PostgreSQL with the REAL migration applied (twice, to
// prove idempotence), plus a PostgREST stand-in for sbSelect/sbRpc that
// mirrors PostgREST's wire format: bytea as "\\x…" text, alias:col::cast.

export const MIGRATION = join(__dirname, "..", "..", "..", "..", "..", "..", "..", "supabase", "migrations", "0036_usdc_index.sql");

/** A free localhost port (fixed ports collide with orphaned servers from aborted runs). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startPg(_preferred?: number) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "usdc-index-pg-"));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const pool = new pg.Pool({ host: "localhost", port, user: "postgres", password: "postgres", database: "postgres", max: 8 });
  await pool.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$`);
  const sql = readFileSync(MIGRATION, "utf8");
  await pool.query(sql);
  await pool.query(sql);
  return {
    pool,
    async stop() {
      await pool.end();
      await server.stop();
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        // Windows can hold the data directory briefly after shutdown; it is a temp dir.
      }
    },
  };
}

const wire = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? `\\x${v.toString("hex")}` : v instanceof Date ? v.toISOString() : v]));

export function postgrest(pool: pg.Pool) {
  const filter = (k: string, v: string, values: unknown[]) => {
    const [op, ...rest] = v.split(".");
    const o = { eq: "=", neq: "<>", gte: ">=", gt: ">", lte: "<=", lt: "<" }[op];
    if (!o) throw new Error(`unsupported filter ${k}=${v}`);
    values.push(decodeURIComponent(rest.join(".")));
    return `"${k}" ${o} $${values.length}`;
  };
  return {
    async sbSelect(table: string, query: string) {
      const values: unknown[] = [];
      const where: string[] = [];
      let cols = "*";
      let tail = "";
      for (const [k, v] of new URLSearchParams(query)) {
        if (k === "select")
          cols = v === "*" ? "*" : v.split(",").map((c) => {
            const m = /^(?:(\w+):)?(\w+)(?:::(\w+))?$/.exec(c);
            if (!m) throw new Error(`bad select ${c}`);
            return `"${m[2]}"${m[3] ? `::${m[3]}` : ""} as "${m[1] ?? m[2]}"`;
          }).join(",");
        else if (k === "limit") tail += ` limit ${Number(v)}`;
        else if (k === "order") tail = ` order by "${v.split(".")[0]}" ${v.endsWith(".desc") ? "desc" : "asc"}` + tail;
        else where.push(filter(k, v, values));
      }
      const r = await pool.query(`select ${cols} from ${table}${where.length ? ` where ${where.join(" and ")}` : ""}${tail}`, values);
      return r.rows.map(wire);
    },
    async sbRpc(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      const r = await pool.query(`select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values);
      if (r.fields.length === 1 && r.fields[0].name === "r") return r.rows[0]?.r ?? null;
      return r.rows.map(wire);
    },
  };
}
