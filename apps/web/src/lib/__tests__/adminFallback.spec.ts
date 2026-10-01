import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import {
  AdminConfigError,
  adminBootstrapEmail,
  assertAdminConfig,
  isBootstrapAdminEmail,
} from "../adminIdentity";

// ---------------------------------------------------------------------------
// T-S1 — no fallback admin identity in production (audit P0-4).
//
// The attack: FURLPAY_ADMIN_EMAIL unset → admin fell back to the seeded demo
// account's email on an unregistered domain, and that seed (roles admin +
// compliance_officer) existed in every production process. Register the domain,
// receive the OTP, become admin. Each layer of that chain is pinned here.
// ---------------------------------------------------------------------------

const PROD = { NODE_ENV: "production" } as const;
const PREVIEW = { NODE_ENV: "production", VERCEL_ENV: "preview" } as const;
const DEV = { NODE_ENV: "development" } as const;
const OLD_FALLBACK = ["ashutosh", "furlpay.app"].join("@");

describe("adminIdentity", () => {
  it("production without FURLPAY_ADMIN_EMAIL: boot check throws", () => {
    expect(() => assertAdminConfig(PROD)).toThrow(AdminConfigError);
  });

  it("production without FURLPAY_ADMIN_EMAIL: nobody is the bootstrap admin", () => {
    expect(adminBootstrapEmail(PROD)).toBeNull();
    expect(isBootstrapAdminEmail(OLD_FALLBACK, PROD)).toBe(false);
    expect(isBootstrapAdminEmail("", PROD)).toBe(false);
    expect(isBootstrapAdminEmail(null, PROD)).toBe(false);
  });

  it("preview without it boots, but still has no bootstrap admin", () => {
    expect(() => assertAdminConfig(PREVIEW)).not.toThrow();
    expect(adminBootstrapEmail(PREVIEW)).toBeNull();
  });

  it("production WITH it: exactly that address, case-insensitive", () => {
    const env = { ...PROD, FURLPAY_ADMIN_EMAIL: " Founder@Example.com " };
    expect(() => assertAdminConfig(env)).not.toThrow();
    expect(adminBootstrapEmail(env)).toBe("founder@example.com");
    expect(isBootstrapAdminEmail("FOUNDER@example.com", env)).toBe(true);
    expect(isBootstrapAdminEmail(OLD_FALLBACK, env)).toBe(false);
  });

  it("rejects a malformed configured value instead of trusting it", () => {
    expect(() => assertAdminConfig({ ...PROD, FURLPAY_ADMIN_EMAIL: "not-an-email" })).toThrow(AdminConfigError);
  });

  it("the demo identity is a development-only convenience", () => {
    expect(adminBootstrapEmail(DEV)).toBe(OLD_FALLBACK);
  });
});

describe("demo seed in a production runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete (globalThis as { __appStateV2?: unknown }).__appStateV2;
  });

  async function freshStore(env: Record<string, string>) {
    delete (globalThis as { __appStateV2?: unknown }).__appStateV2;
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("../store");
  }

  it("no seed account exists and its email resolves to nobody", async () => {
    const store = await freshStore({ NODE_ENV: "production", VERCEL_ENV: "" });
    expect(store.demoSeedAllowed()).toBe(false);
    expect(store.db).toBeUndefined();
    expect(store.getAccount(store.DEMO_USER_ID)).toBeUndefined();
    expect(store.findUserByIdentity({ email: OLD_FALLBACK })).toBeUndefined();
  });

  it("an OTP login for the old fallback email creates a plain, empty, unprivileged account", async () => {
    const store = await freshStore({ NODE_ENV: "production", VERCEL_ENV: "" });
    const { account, created } = store.findOrCreateUserByIdentity({ email: OLD_FALLBACK });
    expect(created).toBe(true);
    expect(account.user.id).not.toBe(store.DEMO_USER_ID);
    expect(account.user.roles).toEqual(["user"]);
    // Production KV refuses its in-memory fallback; an empty grant store is
    // exactly the state under test (no grants exist for this new account).
    vi.doMock("../kv", () => ({
      kvGet: async () => null,
      kvSet: async () => undefined,
      kvSetNx: async () => true,
      kvDel: async () => undefined,
    }));
    const { effectiveRoles } = await import("../compliance/roleGrants");
    expect(await effectiveRoles(account)).toEqual(["user"]);
  });

  it("a preview deployment keeps the seed for guest login, without officer roles", async () => {
    const store = await freshStore({ NODE_ENV: "production", VERCEL_ENV: "preview" });
    expect(store.db).toBeDefined();
    expect(store.db!.user.roles).toEqual(["user"]);
  });
});

describe("boot hook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("instrumentation.register exits the process in production without an admin", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FURLPAY_ADMIN_EMAIL", "");
    vi.stubEnv("NEXT_PHASE", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { register } = await import("../../instrumentation");
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("boots when the admin is configured", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_ADMIN_EMAIL", "founder@example.com");
    // The rest of the production boot contract (lib/bootConfig.ts).
    vi.stubEnv("FURLPAY_SESSION_SECRET", "s".repeat(48));
    vi.stubEnv("SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_x");
    vi.stubEnv("KV_REST_API_URL", "https://kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    vi.stubEnv("NEXT_PHASE", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { register } = await import("../../instrumentation");
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("tripwire: no email-based admin fallback in source", () => {
  const SRC = join(__dirname, "..", "..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full, out);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("no `FURLPAY_ADMIN_EMAIL ?? <literal>` anywhere", () => {
    // A non-empty literal after `??` is a fallback identity; `?? ""` is not.
    const hits = walk(SRC).filter((f) =>
      /FURLPAY_ADMIN_EMAIL\s*\?\?\s*["'`][^"'`]/.test(strip(readFileSync(f, "utf8")))
    );
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("the old fallback address appears only in the dev-only identity + demo seed", () => {
    const allowed = new Set([["lib", "adminIdentity.ts"].join(sep), ["lib", "store.ts"].join(sep)]);
    const hits = walk(SRC)
      .filter((f) => strip(readFileSync(f, "utf8")).includes(OLD_FALLBACK))
      .map((f) => relative(SRC, f))
      .filter((f) => !allowed.has(f));
    expect(hits).toEqual([]);
  });
});
