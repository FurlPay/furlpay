import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Repo-wide tripwire: no money path may use the bypassable biometric gate.
//
// `confirmWithBiometrics` RETURNS TRUE when the user has switched biometric
// approvals off in Settings, or when the device has no enrolled biometrics.
// That is a defensible default for a low-friction gate on an already-unlocked
// app — and it is wrong for anything that moves money, because on such a device
// the action executes with no authentication at all.
//
// This bug was found on the AI co-pilot path, then on Send and Swap, then on
// six further screens (invest, bills, off-ramp, earn, market orders, card
// ordering and reissue). It kept recurring because nothing stopped a new screen
// reaching for the same helper. This test is that stop.
//
// If you are here because this test failed: use `authorizeMoneyMove` from
// lib/money/authorize.ts. It runs the deterministic risk rules and then proves
// device ownership via PIN/pattern/biometric, refusing a device with no lock
// rather than waving it through.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..", "..");

/** Strip comments so a note ABOUT the helper is not mistaken for a call. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith("."))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))].filter(
  // The helper's own definition legitimately mentions it.
  (f) => !f.endsWith(path.join("lib", "biometrics.ts"))
);

describe("no money path uses the bypassable biometric gate", () => {
  it("finds a meaningful number of source files to check", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it("has zero remaining confirmWithBiometrics call sites", () => {
    const offenders = SOURCES.filter((f) =>
      strip(fs.readFileSync(f, "utf8")).includes("confirmWithBiometrics")
    ).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("routes every screen that charges the user through authorizeMoneyMove", () => {
    // Each of these was found calling the bypassable gate during the audit.
    const mustAuthorize = [
      path.join("lib", "send", "useSend.ts"),
      path.join("lib", "swap", "useSwap.ts"),
      path.join("app", "chat.tsx"),
      path.join("app", "bills.tsx"),
      path.join("app", "earn.tsx"),
      path.join("app", "cards", "order.tsx"),
      path.join("app", "cards", "[id].tsx"),
      path.join("app", "market", "[symbol].tsx"),
      path.join("app", "(tabs)", "invest.tsx"),
    ];
    const missing = mustAuthorize.filter((rel) => {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) return true;
      return !strip(fs.readFileSync(full, "utf8")).includes("authorizeMoneyMove");
    });
    expect(missing).toEqual([]);
  });

  it("refuses a refused decision rather than falling through", () => {
    // A call that ignores the verdict is worse than no call: it looks audited.
    const files = SOURCES.filter((f) =>
      strip(fs.readFileSync(f, "utf8")).includes("authorizeMoneyMove(")
    );
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      const src = strip(fs.readFileSync(f, "utf8"));
      if (f.endsWith(path.join("money", "authorize.ts"))) continue; // the definition
      expect(`${path.relative(ROOT, f)}:${/!decision\.ok|!auth\.ok/.test(src)}`).toBe(
        `${path.relative(ROOT, f)}:true`
      );
    }
  });
});

describe("the authorization boundary cannot be self-authorized", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib", "money", "authorize.ts"), "utf8");

  it("takes no caller-supplied verdict", () => {
    const iface = src.slice(
      src.indexOf("export interface AuthorizeInput"),
      src.indexOf("export async function authorizeMoneyMove")
    );
    for (const forbidden of ["decision", "allow:", "override", "skipAuth", "preAuthorized"]) {
      expect(iface).not.toContain(forbidden);
    }
  });

  it("evaluates risk before it ever calls for authentication", () => {
    const assessAt = src.indexOf("assessRisk(");
    const authAt = src.indexOf("requireAuthFor(");
    expect(assessAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(assessAt);
  });

  it("returns before authenticating on BLOCK and on REVIEW", () => {
    const between = src.slice(src.indexOf("assessRisk("), src.indexOf("requireAuthFor("));
    expect(between).toContain('"BLOCK"');
    expect(between).toContain('"REVIEW"');
    // Both branches return, so neither reaches the prompt or the network.
    expect((between.match(/return \{/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
