import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isProductionSupabaseUrl, resolveDataPlane, PRODUCTION_SUPABASE_REFS } from "@/lib/dataPlane";

/*
 * On 11 Oct 2026 the Vercel preview scope carried the production Supabase and
 * Redis credentials: every preview build read and wrote production. These
 * tests pin the guard that withholds durable credentials from a preview that
 * has not been given a data plane of its own, and prove that withholding them
 * makes the backends unavailable rather than silently in-memory.
 */

const PROD_DB = `https://${PRODUCTION_SUPABASE_REFS[0]}.supabase.co`;
const OTHER_DB = "https://previewprojectref.supabase.co";
const creds = (db: string) => ({
  SUPABASE_URL: db,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  KV_REST_API_URL: "https://example.upstash.io",
  KV_REST_API_TOKEN: "kv-token",
});

describe("resolveDataPlane", () => {
  it("passes credentials through on the production deployment", () => {
    const p = resolveDataPlane({ ...creds(PROD_DB), VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(p.blocked).toBeNull();
    expect(p.supabaseUrl).toBe(PROD_DB);
    expect(p.kvUrl).toBe("https://example.upstash.io");
  });

  it("passes credentials through outside Vercel (AWS, containers, local development)", () => {
    expect(resolveDataPlane({ ...creds(PROD_DB), NODE_ENV: "production" }).blocked).toBeNull();
    expect(resolveDataPlane({ ...creds(OTHER_DB), NODE_ENV: "development" }).blocked).toBeNull();
  });

  it("withholds everything from a preview that has not declared its own data plane", () => {
    const p = resolveDataPlane({ ...creds(OTHER_DB), VERCEL_ENV: "preview", NODE_ENV: "production" });
    expect(p).toEqual({ supabaseUrl: undefined, supabaseKey: undefined, kvUrl: undefined, kvToken: undefined, blocked: "preview_not_isolated" });
  });

  it("withholds everything from a Vercel development deployment too", () => {
    expect(resolveDataPlane({ ...creds(OTHER_DB), VERCEL_ENV: "development" }).blocked).toBe("preview_not_isolated");
  });

  it("allows a preview that declares an isolated data plane", () => {
    const p = resolveDataPlane({ ...creds(OTHER_DB), VERCEL_ENV: "preview", FURLPAY_DATA_PLANE: "isolated" });
    expect(p.blocked).toBeNull();
    expect(p.supabaseUrl).toBe(OTHER_DB);
    expect(p.kvToken).toBe("kv-token");
  });

  it("never gives a preview the production database, even when it claims to be isolated", () => {
    const p = resolveDataPlane({ ...creds(PROD_DB), VERCEL_ENV: "preview", FURLPAY_DATA_PLANE: "isolated" });
    expect(p.blocked).toBe("production_database_in_preview");
    expect(p.supabaseUrl).toBeUndefined();
    // The Redis credentials go with it: a scope that still holds the
    // production database cannot be trusted to hold a separate Redis.
    expect(p.kvUrl).toBeUndefined();
    expect(p.kvToken).toBeUndefined();
  });

  it("treats only the exact value as a declaration", () => {
    for (const v of ["", "true", "1", "production", "shared", "isolate"]) {
      expect(resolveDataPlane({ ...creds(OTHER_DB), VERCEL_ENV: "preview", FURLPAY_DATA_PLANE: v }).blocked, v).toBe("preview_not_isolated");
    }
    expect(resolveDataPlane({ ...creds(OTHER_DB), VERCEL_ENV: "preview", FURLPAY_DATA_PLANE: " Isolated " }).blocked).toBeNull();
  });

  it("honours the Upstash variable names as well as the Vercel Marketplace ones", () => {
    const p = resolveDataPlane({ UPSTASH_REDIS_REST_URL: "https://u.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", VERCEL_ENV: "preview" });
    expect(p.kvUrl).toBeUndefined();
    expect(p.blocked).toBe("preview_not_isolated");
  });
});

describe("isProductionSupabaseUrl", () => {
  it("matches the production project ref by host, not by substring", () => {
    expect(isProductionSupabaseUrl(PROD_DB, {})).toBe(true);
    expect(isProductionSupabaseUrl(`${PROD_DB}/rest/v1`, {})).toBe(true);
    expect(isProductionSupabaseUrl(`https://x.supabase.co/?ref=${PRODUCTION_SUPABASE_REFS[0]}`, {})).toBe(false);
    expect(isProductionSupabaseUrl(OTHER_DB, {})).toBe(false);
    expect(isProductionSupabaseUrl(undefined, {})).toBe(false);
    expect(isProductionSupabaseUrl("not a url", {})).toBe(false);
  });

  it("extends the production list from PROD_PROJECT_REFS", () => {
    expect(isProductionSupabaseUrl(OTHER_DB, { PROD_PROJECT_REFS: "aaa, previewprojectref" })).toBe(true);
  });
});

describe("a blocked preview has no backends", () => {
  it("resolves the database to 'none' and the key-value store to 'memory'", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SUPABASE_URL", PROD_DB);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    vi.stubEnv("FURLPAY_DATA_PLANE", "");
    try {
      const { supabaseBackend } = await import("@/lib/supabase");
      const { kvBackend } = await import("@/lib/kv");
      expect(supabaseBackend).toBe("none");
      expect(kvBackend).toBe("memory");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("makes the key-value store refuse rather than fall back to memory in a production build", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    try {
      const { kvGet, kvSet } = await import("@/lib/kv");
      await expect(kvGet("anything")).rejects.toThrow();
      await expect(kvSet("anything", 1)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("private PDF storage follows the same rule", () => {
  const bucket = { RESEARCH_PDF_BUCKET: "research" };

  it("is unconfigured in a preview holding the production credentials, and makes no request", async () => {
    const { storageConfigured, signedPdfUrl } = await import("@/lib/research/storage");
    const env = { ...creds(PROD_DB), ...bucket, VERCEL_ENV: "preview", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    expect(storageConfigured(env)).toBe(false);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await signedPdfUrl("reports/2026.pdf", env)).toEqual({ ok: false, reason: "not_configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("is unconfigured in a preview that has not declared isolation, whatever database it names", async () => {
    const { storageConfigured } = await import("@/lib/research/storage");
    expect(storageConfigured({ ...creds(OTHER_DB), ...bucket, VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("stays configured on the production deployment and in an isolated preview", async () => {
    const { storageConfigured } = await import("@/lib/research/storage");
    expect(storageConfigured({ ...creds(PROD_DB), ...bucket, VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(storageConfigured({ ...creds(OTHER_DB), ...bucket, VERCEL_ENV: "preview", FURLPAY_DATA_PLANE: "isolated" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("no backend bypasses the guard", () => {
  // The guard only works if nothing reads the credentials directly. Reporting
  // code may check PRESENCE of a variable; nothing may build a client from it.
  const ALLOWED = new Set([
    "src/lib/dataPlane.ts",
    "src/lib/env.ts", // presence report
    "src/lib/ops/overview.ts", // presence report (booleans)
    "src/app/api/ops/readiness/route.ts", // presence report
    "src/lib/bootConfig.ts", // boot-time presence check
  ]);
  // ANY property or bracket read of the names, not only `process.env.NAME`: a
  // module that takes `env = process.env` as a parameter and reads
  // `env.SUPABASE_URL` bypasses the guard just the same. The first version of
  // this pattern matched only the `process.env.` form and missed exactly that
  // in lib/research/storage.ts. A name inside a message string is not a read
  // and does not match.
  const NAMES = /(?:\.|\[\s*["'])(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|KV_REST_API_URL|KV_REST_API_TOKEN)\b/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it("only lib/dataPlane.ts and presence reports read the durable credentials", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((f) => NAMES.test(readFileSync(f, "utf8")))
      .map((f) => "src" + f.slice(root.length).replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders, "these files read database or key-value credentials directly instead of through lib/dataPlane.ts").toEqual([]);
  });
});
