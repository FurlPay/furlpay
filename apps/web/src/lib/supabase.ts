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

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
