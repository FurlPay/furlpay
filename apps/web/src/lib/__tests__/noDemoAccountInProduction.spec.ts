// ---------------------------------------------------------------------------
// CI gate: production code may not read the seeded demo account.
//
// `db` (lib/store.ts) is the seeded demo account and exists in EVERY process,
// production included. Two audits (Sep 30 2026) found the same bug class over
// and over: a route or service that read `db`, or defaulted a user id to
// `DEMO_USER_ID`, computed a real user's answer from a stranger's data — the
// copilot, analytics, receipts, compliance routing, credit, card-auth velocity,
// tax reports, deposit crediting. Each was fixed where found; this makes the
// NEXT one a test failure instead of a production incident.
//
// ALLOWED is a reviewed list. Adding to it needs a reason that says why the
// file can never serve a real user's data from the demo account.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDevelopmentDemoAccount } from "@/lib/store";

const SRC = path.resolve(__dirname, "..", "..");

const ALLOWED: Record<string, string> = {
  "lib/store.ts": "defines the demo account",
  "app/api/auth/guest/route.ts":
    "intentional demo login; refused on production deployments, opt-in on previews, mints role 'user' only",
  "app/api/auth/dev-session/route.ts":
    "local-development auto sign-in; 404 unless NODE_ENV !== production AND FURLPAY_DEV_AUTO_LOGIN=1 (devAutoLogin.spec.ts), mints role 'user' only",
  "app/api/auth/webauthn/route.ts": "legacy demo passkey route; 404 when NODE_ENV=production",
  "lib/accountDeletion.ts": "compares against DEMO_USER_ID to REFUSE deleting the shared demo account",
  "lib/ledger.ts": "seedDemoOpeningBalance() only; returns early outside the development environment",
};

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

/** Blank comments so a history note mentioning `db.user` is not a finding. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const DEMO_IMPORT = /import\s*\{[^}]*\b(db|DEMO_USER_ID)\b[^}]*\}\s*from\s*["'](@\/lib\/store|\.{1,2}\/store)["']/;

function offenders(): string[] {
  const out: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    if (ALLOWED[rel]) continue;
    const src = code(fs.readFileSync(file, "utf8"));
    if (DEMO_IMPORT.test(src)) out.push(`${rel}: imports the demo account`);
    else if (/\bDEMO_USER_ID\b/.test(src) || /\bdb\.(user|transactions|tokenBalances|fiatBalances|holdings|cards|bills|tradeLots)\b/.test(src))
      out.push(`${rel}: references the demo account`);
  }
  return out;
}

describe("no production module reads the seeded demo account", () => {
  it("finds no demo-account import or reference outside the reviewed allowlist", () => {
    expect(offenders()).toEqual([]);
  });

  it("every allowlisted file still exists (the list cannot rot into a blanket exemption)", () => {
    for (const rel of Object.keys(ALLOWED)) expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true);
  });
});

// getDevelopmentDemoAccount() is the ONE sanctioned way for a dev fallback to
// reach the demo account (account/fund, escrow and the Stripe webhook use it),
// which is why importing it is not a finding above. Its production guard is
// what makes that safe, so it is pinned here.
describe("the sanctioned dev fallback is dead in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns nothing on any production build, previews included", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getDevelopmentDemoAccount()).toBeUndefined();
  });
});
