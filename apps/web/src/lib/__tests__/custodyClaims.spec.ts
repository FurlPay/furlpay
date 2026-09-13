import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Custody-claim honesty guard.
//
// The public site told users, on ~30 pages including the Terms of Service, the
// Risk Disclosure and the Refund Policy, that FurlPay used "2-of-2 MPC custody"
// and that "no single device or party can move funds alone".
//
// That was false. `lib/services/turnkey.ts` calls a REMOTE ENCLAVE that returns
// a COMPLETE signature; the device contributes no key share. README.md and
// PROGRESS.md had already recorded this internally while the marketing kept
// saying otherwise — which is exactly the failure mode a test can prevent from
// recurring, and prose review cannot.
//
// A false custody claim is not a marketing nit. It tells someone the wrong
// thing about who can take their money, and it changes regulatory scope
// (custodial VDA custody moves FIU-IND treatment, insurance and balance-sheet
// classification).
//
// This test fails the build if the claim reappears in user-facing copy.
// docs/CUSTODY-DISCLOSURE.md holds the accurate description.
// ---------------------------------------------------------------------------

const APP = join(__dirname, "..", "..", "app");
const COMPONENTS = join(__dirname, "..", "..", "components");

/** Phrases that assert key-splitting or non-custodial web signing. */
const BANNED: { pattern: RegExp; why: string }[] = [
  {
    pattern: /2-of-2\s+MPC/i,
    why: 'claims threshold key-splitting that does not exist (Turnkey returns a complete signature)',
  },
  {
    pattern: /MPC\s+custody/i,
    why: 'describes custody as multi-party when web signing is custodial via a single enclave credential',
  },
  {
    pattern: /(key|signing key)\s+is\s+split/i,
    why: 'no key is split — the device holds no share on the web path',
  },
  {
    pattern: /no\s+single\s+(device|party)\s+(or\s+party\s+)?can\s+move\s+funds/i,
    why: 'untrue for the web path: the Turnkey org credential alone can produce signatures',
  },
  {
    pattern: /device\s+share/i,
    why: 'there is no device share',
  },
];

/**
 * Files that may legitimately contain the phrases: the correction itself has to
 * quote what it is correcting.
 */
const ALLOWED = new Set([
  join(APP, "docs", "security", "mpc-webauthn", "page.tsx"),
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("custody claims", () => {
  const files = [...walk(APP), ...walk(COMPONENTS)].filter((f) => !ALLOWED.has(f));

  it("scans a meaningful number of files (guard against a broken walk)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const { pattern, why } of BANNED) {
    it(`no user-facing page claims ${pattern.source} — ${why}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        if (pattern.test(text)) {
          offenders.push(file.replace(join(__dirname, "..", "..", ".."), ""));
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the correction document exists and names the custodial path", () => {
    const doc = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "docs", "CUSTODY-DISCLOSURE.md"),
      "utf8",
    );
    expect(doc).toMatch(/CUSTODIAL/);
    expect(doc).toMatch(/Turnkey/);
    // It must keep saying which path is self-custodial, not flatten both.
    expect(doc).toMatch(/self-custodial/i);
  });
});
