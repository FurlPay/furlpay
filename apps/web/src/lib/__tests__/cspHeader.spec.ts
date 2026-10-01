import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { join } from "path";

// T-S3 (audit P2-1): the production CSP carries no 'unsafe-eval'. Development
// keeps it (React Refresh needs it). Reads the REAL next.config.js headers().

const require_ = createRequire(import.meta.url);
const CONFIG = join(__dirname, "..", "..", "..", "next.config.js");

async function cspFor(nodeEnv: string): Promise<string> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  delete require_.cache[require_.resolve(CONFIG)];
  const factory = require_(CONFIG) as () => Promise<{ headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }>;
  const cfg = await factory();
  const all = await cfg.headers();
  const h = all.flatMap((r) => r.headers).find((x) => x.key === "Content-Security-Policy");
  if (!h) throw new Error("no CSP header configured");
  return h.value;
}

afterEach(() => vi.unstubAllEnvs());

describe("Content-Security-Policy", () => {
  it("production: script-src has no 'unsafe-eval'", async () => {
    const csp = await cspFor("production");
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("development keeps 'unsafe-eval' for React Refresh", async () => {
    expect(await cspFor("development")).toContain("'unsafe-eval'");
  });
});
