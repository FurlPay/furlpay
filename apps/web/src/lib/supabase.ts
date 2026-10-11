// ---------------------------------------------------------------------------
// Supabase (Postgres) adapter — the durable backend the in-memory store
// migrates onto (schema: supabase/migrations/0001_init.sql).
//
// Same conventions as kv.ts: plain fetch against the REST API (PostgREST),
// no SDK dependency, works on Node and Edge runtimes. Server-side only —
// authenticated with the service-role key, which bypasses RLS; every table
// has RLS enabled with zero policies so the anon key reads nothing.
//
// This is the migration-prep layer: store.ts still serves reads/writes from
// memory until its accessors are switched over (see supabase/README.md).
// ---------------------------------------------------------------------------

import { dataPlane } from "@/lib/dataPlane";

// Read through lib/dataPlane.ts: a preview deployment without its own data
// plane gets no credentials here, so it cannot reach the production database.
const SB_URL = dataPlane.supabaseUrl;
const SB_KEY = dataPlane.supabaseKey;

/** "supabase" when credentials are present, else "none" (in-memory store). */
export const supabaseBackend: "supabase" | "none" = SB_URL && SB_KEY ? "supabase" : "none";

class SupabaseError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`supabase error ${status}: ${body}`);
    this.status = status;
  }
}

async function rest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  prefer?: string
): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY!,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new SupabaseError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** SELECT with PostgREST filters, e.g. sbSelect("users", "email=eq.a@b.c&limit=1"). */
export async function sbSelect<T>(table: string, query = ""): Promise<T[]> {
  return rest<T[]>("GET", `${table}${query ? `?${query}` : ""}`);
}

/**
 * Exact row count for a PostgREST filter, without transferring rows: a HEAD
 * request with `Prefer: count=exact`, read from Content-Range (`*\/123` or
 * `0-24/123`). Throws when the range header is absent or unparseable rather
 * than guessing a number.
 */
export async function sbCount(table: string, query = ""): Promise<number> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method: "HEAD",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, Prefer: "count=exact" },
    cache: "no-store",
  });
  if (!res.ok) throw new SupabaseError(res.status, `count ${table} failed`);
  const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
  if (total === undefined) throw new SupabaseError(res.status, `count ${table}: no Content-Range total`);
  return Number(total);
}

/** Thrown when a Postgres function hasn't been created yet (migration not
 *  applied). Callers use this to fall back rather than fail the write. */
export class SupabaseFunctionMissing extends Error {}

/** Call a Postgres function (RPC). Runs in ONE transaction server-side, which
 *  is the only way to make a multi-table write atomic over PostgREST. */
export async function sbRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rest<T>("POST", `rpc/${fn}`, args);
  } catch (e) {
    // PGRST202 = "function not found in schema cache" — surfaced as 404.
    if (e instanceof SupabaseError && e.status === 404) {
      throw new SupabaseFunctionMissing(fn);
    }
    throw e;
  }
}

/** INSERT one or more rows; returns the created rows. */
export async function sbInsert<T>(table: string, rows: T | T[]): Promise<T[]> {
  return rest<T[]>("POST", table, rows, "return=representation");
}

/** INSERT that silently keeps the existing row on a primary-key conflict
 *  (Prefer: resolution=ignore-duplicates). For idempotent event writes. */
export async function sbInsertIgnoreDuplicates<T>(table: string, rows: T | T[], signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY!,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new SupabaseError(res.status, await res.text());
}

/** UPSERT on the table's primary key / unique constraint. */
export async function sbUpsert<T>(table: string, rows: T | T[]): Promise<T[]> {
  return rest<T[]>("POST", table, rows, "resolution=merge-duplicates,return=representation");
}

/** UPDATE rows matched by a PostgREST filter; returns the updated rows. */
export async function sbUpdate<T>(table: string, query: string, patch: Partial<T>): Promise<T[]> {
  return rest<T[]>("PATCH", `${table}?${query}`, patch, "return=representation");
}

/** DELETE rows matched by a PostgREST filter. The filter is required —
 *  PostgREST rejects unfiltered deletes, and so do we. */
export async function sbDelete(table: string, query: string): Promise<void> {
  if (!query) throw new Error("sbDelete requires a filter");
  await rest<void>("DELETE", `${table}?${query}`);
}
