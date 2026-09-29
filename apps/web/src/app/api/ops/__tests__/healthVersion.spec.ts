import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInfo } from "@/lib/ops/buildInfo";

// ---------------------------------------------------------------------------
// Release provenance: /api/ops/health must answer "what exact commit is in
// production?". VERCEL_GIT_COMMIT_SHA is set only for git-integration deploys;
// FurlPay ships via manual `vercel deploy` CLI, which does NOT set it — so
// production reported "dev" and the live commit was unprovable (see
// RELEASE_PROVENANCE.md: the Sep 08 prod deploy carried no recoverable SHA).
// buildInfo() adds a full, secret-free provenance block with a CLI fallback.
// ---------------------------------------------------------------------------

const PROVENANCE_ENV = [
  "VERCEL_GIT_COMMIT_SHA",
  "FURLPAY_BUILD_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "FURLPAY_BUILD_BRANCH",
  "VERCEL_DEPLOYMENT_ID",
  "FURLPAY_BUILD_ID",
  "VERCEL_ENV",
  "FURLPAY_BUILD_TIME",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of PROVENANCE_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of PROVENANCE_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("buildInfo() provenance", () => {
  it("surfaces git-integration metadata when present", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    process.env.VERCEL_GIT_COMMIT_REF = "release/production-2026-09-29";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_123";
    process.env.VERCEL_ENV = "production";
    const b = buildInfo();
    expect(b.commitSha).toBe("abcdef1234567890");
    expect(b.commitShaShort).toBe("abcdef1");
    expect(b.branch).toBe("release/production-2026-09-29");
    expect(b.buildId).toBe("dpl_123");
    expect(b.environment).toBe("production");
  });

  it("falls back to FURLPAY_BUILD_SHA for CLI deploys", () => {
    process.env.FURLPAY_BUILD_SHA = "9f8e7d6c5b4a3210";
    expect(buildInfo().commitShaShort).toBe("9f8e7d6");
  });

  it("degrades every field to 'unknown' when nothing is set — never throws", () => {
    const b = buildInfo();
    expect(b).toEqual({
      commitSha: "unknown",
      commitShaShort: "unknown",
      branch: "unknown",
      buildId: "unknown",
      environment: expect.any(String), // NODE_ENV during tests
      deployedAt: "unknown",
    });
  });

  it("exposes NO secret-shaped values", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    const serialized = JSON.stringify(buildInfo());
    expect(serialized).not.toMatch(/service_role|sk_live|SUPABASE_|SECRET|PRIVATE|eyJ/i);
  });
});

describe("route source invariants", () => {
  const ROUTE = readFileSync(join(__dirname, "..", "health", "route.ts"), "utf8");

  it("keeps the endpoint behind requireOpsAdmin (auth unchanged)", () => {
    expect(ROUTE).toMatch(/requireOpsAdmin\(req\)/);
  });

  it("surfaces the build provenance block to operators", () => {
    expect(ROUTE).toMatch(/build:\s*buildInfo\(\)/);
  });

  it("build provenance reads only safe env vars, never a service key", () => {
    const src = readFileSync(join(__dirname, "..", "..", "..", "..", "lib", "ops", "buildInfo.ts"), "utf8");
    expect(src).not.toMatch(/SERVICE_ROLE|SECRET|PRIVATE_KEY|SUPABASE_KEY/);
  });
});
