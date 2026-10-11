// ---------------------------------------------------------------------------
// Every env var production code reads is registered in lib/env.ts
// (AGENTS.md rule 10).
//
// The Sep 30 2026 audit found 52 unregistered reads, several of them secrets
// (TURNKEY_API_PRIVATE_KEY, STRIPE_ISSUING_KEY, CRON_SECRET, a webhook secret).
// An unregistered variable is invisible to /api/security/env, so a production
// deployment missing it looks healthy until the code path runs. This makes a
// new unregistered read a test failure.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENV_REGISTRY } from "@/lib/env";

const SRC = path.resolve(__dirname, "..", "..");

/** Set by the platform or the runtime, not by FurlPay configuration. */
const PLATFORM = new Set([
  "NODE_ENV",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  // Set by AWS Lambda / ECS; lib/session.ts reads them to detect a hosted runtime.
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "ECS_CONTAINER_METADATA_URI_V4",
  "CI",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  "TZ",
  "PORT",
  "HOSTNAME",
]);

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name)) {
      yield full;
    }
  }
}

describe("environment registry", () => {
  it("registers every process.env read in production code", () => {
    const registered = new Set(ENV_REGISTRY.flatMap((g) => g.vars.map((v) => v.name)));
    const missing = new Map<string, string>();
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        const name = m[1];
        if (registered.has(name) || PLATFORM.has(name) || name.startsWith("VERCEL_GIT_")) continue;
        if (!missing.has(name)) missing.set(name, path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it("never registers a secret under a client-exposed NEXT_PUBLIC_ name", () => {
    const leaked = ENV_REGISTRY.flatMap((g) => g.vars.map((v) => v.name)).filter(
      (n) => n.startsWith("NEXT_PUBLIC_") && /SECRET|PRIVATE|SERVICE_ROLE|API_KEY|TOKEN|PASSWORD/.test(n)
    );
    expect(leaked).toEqual([]);
  });
});
