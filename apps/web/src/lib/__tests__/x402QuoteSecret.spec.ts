// X402_QUOTE_SECRET: no published default, ever.
//
// Production furlpay.com ran without X402_QUOTE_SECRET (checked 6 Oct 2026), so
// lib/x402.ts and lib/mpp.ts signed every quote binding with the literal
// "x402_dev_quote_secret_change_me" from this repository.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  MIN_QUOTE_SECRET_LENGTH,
  QuoteSecretMissingError,
  __resetDevQuoteSecret,
  quoteSecret,
  quoteSecretConfigured,
} from "../x402QuoteSecret";

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
// A healthy store with no pauses, so the routes reach the secret check. (In
// production mode the real KV layer refuses its in-memory fallback.)
vi.mock("@/lib/kv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kv")>()),
  kvGet: vi.fn(async () => null),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  __resetDevQuoteSecret();
});

describe("quoteSecret in production", () => {
  it("refuses to run without the secret — no fallback", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "");
    expect(quoteSecretConfigured()).toBe(false);
    expect(() => quoteSecret()).toThrow(QuoteSecretMissingError);
  });

  it("refuses a secret shorter than the minimum", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "x".repeat(MIN_QUOTE_SECRET_LENGTH - 1));
    expect(quoteSecretConfigured()).toBe(false);
    expect(() => quoteSecret()).toThrow(QuoteSecretMissingError);
  });

  it("uses the configured secret", () => {
    const value = "s".repeat(MIN_QUOTE_SECRET_LENGTH + 8);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", value);
    expect(quoteSecretConfigured()).toBe(true);
    expect(quoteSecret().toString()).toBe(value);
  });

  it("never puts the value in the error", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "short-but-secret");
    try {
      quoteSecret();
    } catch (e) {
      expect((e as Error).message).not.toContain("short-but-secret");
    }
  });
});

describe("quoteSecret outside production", () => {
  it("uses a RANDOM per-process secret when unset — never a known string", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("X402_QUOTE_SECRET", "");
    const a = quoteSecret();
    expect(a.length).toBe(32);
    expect(quoteSecret().equals(a)).toBe(true); // stable within the process
    __resetDevQuoteSecret();
    expect(quoteSecret().equals(a)).toBe(false); // but not predictable
    expect(a.toString()).not.toMatch(/change_me|dev_quote_secret/);
  });
});

describe("no published default anywhere in the app", () => {
  it("the old literal is gone from apps/web/src", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "node_modules" || name === "__tests__") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("x402_dev_quote_secret")) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

describe("the quote routes without a secret in production", () => {
  it("/api/x402/fx and /api/mpp/fx answer 503 x402_not_configured, not a crash", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("X402_QUOTE_SECRET", "");
    const { GET: x402 } = await import("@/app/api/x402/fx/route");
    const { GET: mpp } = await import("@/app/api/mpp/fx/route");
    for (const [get, path] of [[x402, "x402"], [mpp, "mpp"]] as const) {
      const res = await get(new NextRequest(`https://furlpay.com/api/${path}/fx?from=USD&to=EUR&amount=100`));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("x402_not_configured");
    }
  });
});
