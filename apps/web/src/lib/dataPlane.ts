// ---------------------------------------------------------------------------
// Which durable data plane this deployment may use.
//
// WHY THIS EXISTS. On 11 Oct 2026 the Vercel PREVIEW scope held the production
// Supabase and Redis credentials, so every preview build of every branch read
// and wrote the production database and spent the production Redis quota.
// Nothing in the code objected, because the code only ever asked "are
// credentials present?" — never "are these the credentials this deployment is
// allowed to use?".
//
// THE RULE. A Vercel deployment that is not the production deployment
// (VERCEL_ENV = preview | development) gets NO durable credentials unless the
// operator has declared that the scope carries its own:
//
//   FURLPAY_DATA_PLANE=isolated
//
// and, declared or not, it never gets a Supabase URL that names a production
// project, nor a key-value host listed in PROD_KV_HOSTS. The declaration is a
// statement of intent; the identity checks are what refuse a wrong resource. Withheld credentials make `supabaseBackend` "none" and `kvBackend`
// "memory"; a production build then refuses its in-memory fallbacks
// (lib/kv.ts assertDurableBackend, the storage guards), so data routes answer
// 503. That is the intended outcome: a preview with no data plane of its own
// renders pages and moves nothing.
//
// WHAT IS UNTOUCHED. The production deployment (VERCEL_ENV=production), every
// deployment outside Vercel (AWS, containers: VERCEL_ENV unset) and local
// development. Local scripts have their own guard (scripts/lib/env-guard.mjs).
//
// Every module that selects a backend reads credentials through here, so there
// is one place to reason about and one place to test.
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** Supabase project refs that are production. Kept in step with scripts/lib/env-guard.mjs. */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ["iyarllmcednkbekweucd"];

export type DataPlaneBlock =
  /** A non-production Vercel deployment that has not declared its own data plane. */
  | "preview_not_isolated"
  /** A non-production deployment whose Supabase URL names a production project. */
  | "production_database_in_preview"
  /** A non-production deployment whose key-value store host is a declared production host. */
  | "production_kv_in_preview";

export interface DataPlane {
  supabaseUrl: string | undefined;
  supabaseKey: string | undefined;
  kvUrl: string | undefined;
  kvToken: string | undefined;
  /** Why durable credentials were withheld, or null when they were not. */
  blocked: DataPlaneBlock | null;
}

function productionRefs(env: Env): string[] {
  return [...PRODUCTION_SUPABASE_REFS, ...(env.PROD_PROJECT_REFS ?? "").split(",")].map((r) => r.trim().toLowerCase()).filter(Boolean);
}

/** True when `url` is a Supabase URL for a production project (`https://<ref>.supabase.co`). */
export function isProductionSupabaseUrl(url: string | undefined, env: Env = process.env): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const ref = host.split(".")[0];
  return productionRefs(env).includes(ref);
}

/**
 * True when `url` points at a key-value host declared as production in
 * PROD_KV_HOSTS (comma-separated hostnames). There is no built-in list: a Redis
 * hostname is not derivable from anything in this repository, so the operator
 * names it. Hostnames are not secrets.
 */
export function isProductionKvUrl(url: string | undefined, env: Env = process.env): boolean {
  if (!url) return false;
  const hosts = (env.PROD_KV_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) return false;
  try {
    return hosts.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** A deployment on Vercel that is not the production one. */
export function isNonProductionVercelDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development";
}

export function resolveDataPlane(env: Env = process.env): DataPlane {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const kvUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const kvToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const withheld = (blocked: DataPlaneBlock): DataPlane => ({ supabaseUrl: undefined, supabaseKey: undefined, kvUrl: undefined, kvToken: undefined, blocked });

  if (isNonProductionVercelDeployment(env)) {
    // Checked first and unconditionally: declaring isolation cannot make a
    // production database acceptable in a preview.
    if (isProductionSupabaseUrl(supabaseUrl, env)) return withheld("production_database_in_preview");
    if (isProductionKvUrl(kvUrl, env)) return withheld("production_kv_in_preview");
    if ((env.FURLPAY_DATA_PLANE ?? "").trim().toLowerCase() !== "isolated") return withheld("preview_not_isolated");
  }
  return { supabaseUrl, supabaseKey, kvUrl, kvToken, blocked: null };
}

/** Resolved once per process: backend selection is a module-level decision everywhere it is made. */
export const dataPlane: DataPlane = resolveDataPlane();

export const DATA_PLANE_BLOCK_DETAIL: Record<DataPlaneBlock, string> = {
  preview_not_isolated:
    "This is a non-production Vercel deployment and FURLPAY_DATA_PLANE is not \"isolated\", so durable database and key-value credentials are withheld. " +
    "Give the preview scope its own Supabase project and Redis store, then set FURLPAY_DATA_PLANE=isolated in that scope.",
  production_database_in_preview:
    "This is a non-production Vercel deployment whose SUPABASE_URL names a production project. Durable credentials are withheld. " +
    "Remove the production database credentials from the preview scope.",
  production_kv_in_preview:
    "This is a non-production Vercel deployment whose key-value store host is listed in PROD_KV_HOSTS. Durable credentials are withheld. " +
    "Remove the production Redis credentials from the preview scope.",
};
