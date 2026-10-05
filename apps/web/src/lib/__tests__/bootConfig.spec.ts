import { describe, expect, it } from "vitest";
import { BootConfigError, assertBootConfig, missingCoreVariables, placeholderVariables } from "../bootConfig";
import { AdminConfigError } from "../adminIdentity";

// Production refuses to boot on unsafe configuration (P0-4, P0-5).

const GOOD = {
  NODE_ENV: "production",
  FURLPAY_ADMIN_EMAIL: "founder@example.com",
  FURLPAY_SESSION_SECRET: "s".repeat(48),
  SUPABASE_URL: "https://ref.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
  KV_REST_API_URL: "https://kv.upstash.io",
  KV_REST_API_TOKEN: "t",
};

describe("assertBootConfig", () => {
  it("boots with a complete production configuration", () => {
    expect(() => assertBootConfig(GOOD)).not.toThrow();
  });

  it("refuses a Terraform placeholder that reached the process (e.g. a webhook secret)", () => {
    expect(() => assertBootConfig({ ...GOOD, STRIPE_WEBHOOK_SECRET: "REPLACE_ME" })).toThrow(BootConfigError);
    expect(placeholderVariables({ A: "REPLACE_ME", B: "real", C: " whsec_placeholder " })).toEqual(["A", "C"]);
  });

  it.each(["FURLPAY_SESSION_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])("refuses without %s", (k) => {
    expect(() => assertBootConfig({ ...GOOD, [k]: "" })).toThrow(BootConfigError);
  });

  it("accepts either KV naming scheme, refuses neither", () => {
    const { KV_REST_API_URL: _u, KV_REST_API_TOKEN: _t, ...noKv } = GOOD;
    expect(missingCoreVariables(noKv)).toContain("KV_REST_API_URL/KV_REST_API_TOKEN");
    expect(missingCoreVariables({ ...noKv, UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" })).toEqual([]);
  });

  it("the admin rule still applies first: a malformed admin email refuses to boot", () => {
    expect(() => assertBootConfig({ ...GOOD, FURLPAY_ADMIN_EMAIL: "not-an-email" })).toThrow(AdminConfigError);
  });

  it("a MISSING admin email boots with administration disabled and a warning, never an outage", () => {
    const report = assertBootConfig({ ...GOOD, FURLPAY_ADMIN_EMAIL: "" });
    expect(report.warnings.join(" ")).toMatch(/administration is DISABLED/);
  });

  it("previews and development are not held to production requirements", () => {
    expect(() => assertBootConfig({ NODE_ENV: "production", VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertBootConfig({ NODE_ENV: "development", STRIPE_WEBHOOK_SECRET: "REPLACE_ME" })).not.toThrow();
  });
});
