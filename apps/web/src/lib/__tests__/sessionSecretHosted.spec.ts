import { afterEach, describe, expect, it, vi } from "vitest";

// Audit F-7: the public development fallback secret was gated on NODE_ENV
// alone. A hosted staging or preview runtime started with NODE_ENV=development
// would have signed forgeable sessions.
const PLATFORM_VARS = ["VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "AWS_EXECUTION_ENV", "ECS_CONTAINER_METADATA_URI_V4"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function sign() {
  const { signSession } = await import("@/lib/session");
  return signSession({ sub: "u_1", roles: ["user"] } as never);
}

describe("the development session secret never runs on a hosted platform", () => {
  it("is still available on a developer machine with no platform variables", async () => {
    vi.stubEnv("FURLPAY_SESSION_SECRET", "");
    for (const v of PLATFORM_VARS) vi.stubEnv(v, "");
    await expect(sign()).resolves.toMatch(/^ey/);
  });

  for (const v of PLATFORM_VARS) {
    it(`is refused when ${v} is set, even with NODE_ENV=${process.env.NODE_ENV}`, async () => {
      vi.stubEnv("FURLPAY_SESSION_SECRET", "");
      for (const other of PLATFORM_VARS) vi.stubEnv(other, "");
      vi.stubEnv(v, v === "VERCEL_ENV" ? "preview" : "x");
      await expect(sign()).rejects.toThrow(/FURLPAY_SESSION_SECRET/);
    });
  }

  it("a configured strong secret works on a hosted platform", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("FURLPAY_SESSION_SECRET", "s".repeat(48));
    await expect(sign()).resolves.toMatch(/^ey/);
  });

  it("isHostedRuntime reads only platform-set variables", async () => {
    const { isHostedRuntime } = await import("@/lib/session");
    expect(isHostedRuntime({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isHostedRuntime({ VERCEL_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isHostedRuntime({ AWS_LAMBDA_FUNCTION_NAME: "web" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
