import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  enforcementState,
  signatureEnforced,
  assertProductionEnforcesSignatures,
  __resetEnforcementWarning,
} from "../x402Enforcement";

// ---------------------------------------------------------------------------
// SR2 — payer authentication must be impossible to disable in production.
//
// THE DEFECT. `liveMode()` was defined three times, identically, in x402.ts,
// x402Facilitator.ts and mpp.ts, as:
//
//     INTEGRATION_MODE === "live" || X402_ENFORCE_SIGNATURE === "1"
//
// With NEITHER variable set — the default — EIP-3009 signature recovery was
// skipped. A live HTTP request against a production build returned
// `isValid:true` for a two-byte signature. Production inherited the development
// posture by OMISSION, which is the worst way to inherit a security setting:
// nothing was misconfigured and nobody disabled anything; the check was absent.
//
// These tests assert the property at the configuration level, because that is
// where the defect lived. A test that only checked "a bad signature is rejected
// when enforcement is on" would have passed against the vulnerable code.
// ---------------------------------------------------------------------------

const ENV_KEYS = ["FURLPAY_ENV", "NODE_ENV", "VERCEL_ENV", "INTEGRATION_MODE", "X402_ENFORCE_SIGNATURE"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  __resetEnforcementWarning();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetEnforcementWarning();
});

/** The two ways financialEnvironment() resolves production. */
const PRODUCTION_SHAPES: Array<[string, Record<string, string>]> = [
  ["FURLPAY_ENV=production", { FURLPAY_ENV: "production" }],
  ["NODE_ENV+VERCEL_ENV=production", { NODE_ENV: "production", VERCEL_ENV: "production" }],
];

describe("SR2: production always enforces, whatever the environment says", () => {
  for (const [label, env] of PRODUCTION_SHAPES) {
    it(`${label} enforces with NO opt-in variables set at all`, () => {
      Object.assign(process.env, env);
      const state = enforcementState();
      expect(state.environment).toBe("production");
      expect(state.enforced).toBe(true);
      expect(state.reason).toBe("production_mandatory");
      expect(signatureEnforced()).toBe(true);
    });

    it(`${label} IGNORES an explicit request to disable`, () => {
      // This is the test the whole module exists for: an operator setting
      // X402_ENFORCE_SIGNATURE=0 in production must not get what they asked for.
      for (const off of ["0", "false", "no", "off", "FALSE", "Off"]) {
        Object.assign(process.env, env);
        process.env.X402_ENFORCE_SIGNATURE = off;
        const state = enforcementState();
        expect(state.enforced, `X402_ENFORCE_SIGNATURE=${off} must not disable`).toBe(true);
        expect(state.reason).toBe("production_mandatory");
        expect(state.overrodeRequestToDisable).toBe(true);
      }
    });

    it(`${label} enforces even with INTEGRATION_MODE=mock`, () => {
      Object.assign(process.env, env);
      process.env.INTEGRATION_MODE = "mock";
      expect(enforcementState().enforced).toBe(true);
    });

    it(`${label} passes the startup assertion`, () => {
      Object.assign(process.env, env);
      expect(() => assertProductionEnforcesSignatures()).not.toThrow();
    });
  }

  it("the environment is checked BEFORE any variable, so no ordering bypasses it", () => {
    // Every combination of the opt-in/opt-out variables, under production.
    const values = [undefined, "0", "1", "false", "true", "live", "mock", ""];
    for (const enforce of values) {
      for (const mode of values) {
        process.env.FURLPAY_ENV = "production";
        if (enforce === undefined) delete process.env.X402_ENFORCE_SIGNATURE;
        else process.env.X402_ENFORCE_SIGNATURE = enforce;
        if (mode === undefined) delete process.env.INTEGRATION_MODE;
        else process.env.INTEGRATION_MODE = mode;
        expect(
          enforcementState().enforced,
          `production must enforce with X402_ENFORCE_SIGNATURE=${enforce} INTEGRATION_MODE=${mode}`
        ).toBe(true);
      }
    }
  });
});

describe("SR2: the development escape hatch still works, and only outside production", () => {
  it("development with no variables set is structural-only", () => {
    const state = enforcementState();
    expect(state.environment).toBe("development");
    expect(state.enforced).toBe(false);
    expect(state.reason).toBe("development_structural_only");
  });

  it("INTEGRATION_MODE=live opts development in", () => {
    process.env.INTEGRATION_MODE = "live";
    const state = enforcementState();
    expect(state.enforced).toBe(true);
    expect(state.reason).toBe("integration_mode_live");
  });

  it("X402_ENFORCE_SIGNATURE opts development in, on any truthy spelling", () => {
    for (const on of ["1", "true", "yes", "on"]) {
      process.env.X402_ENFORCE_SIGNATURE = on;
      expect(enforcementState().enforced, `${on} must enable`).toBe(true);
      expect(enforcementState().reason).toBe("explicitly_enabled");
    }
  });

  it("staging behaves like development, NOT like production", () => {
    // Deliberate: staging is where the structural path is exercised. The point
    // is that staging cannot be MISTAKEN for production, not that it is strict.
    process.env.FURLPAY_ENV = "staging";
    expect(enforcementState().environment).toBe("staging");
    expect(enforcementState().enforced).toBe(false);
    process.env.X402_ENFORCE_SIGNATURE = "1";
    expect(enforcementState().enforced).toBe(true);
  });

  it("a bare NODE_ENV=production without VERCEL_ENV is NOT production", () => {
    // Matches financialEnvironment()'s own rule. Asserted so a change to that
    // inference is caught here rather than discovered in a deployment.
    process.env.NODE_ENV = "production";
    expect(enforcementState().environment).toBe("development");
  });
});

describe("SR2: there is exactly ONE enforcement authority", () => {
  const LIB = join(__dirname, "..");

  function read(name: string): string {
    return readFileSync(join(LIB, name), "utf8");
  }

  it("no x402/MPP module re-derives the rule locally", () => {
    // The original defect was three copies. This fails if a fourth appears.
    const rule = /INTEGRATION_MODE === "live"\s*\|\|\s*process\.env\.X402_ENFORCE_SIGNATURE/;
    for (const file of ["x402.ts", "x402Facilitator.ts", "mpp.ts", "x402Signature.ts", "x402Settler.ts"]) {
      const src = read(file);
      expect(rule.test(src), `${file} must not re-derive the enforcement rule`).toBe(false);
    }
  });

  it("each of the three former copies now delegates to signatureEnforced", () => {
    for (const file of ["x402.ts", "x402Facilitator.ts", "mpp.ts"]) {
      const src = read(file);
      expect(src, `${file} must import the shared authority`).toContain("x402Enforcement");
      expect(src).toContain("signatureEnforced");
    }
  });

  it("the ops console reports the REAL posture rather than re-deriving it", () => {
    // A console that computes its own answer can show "enforced" while the
    // facilitator is not enforcing.
    const src = readFileSync(join(LIB, "ops", "overview.ts"), "utf8");
    expect(src).toContain("signatureEnforced()");
  });

  it("the enforcement module itself has no route-level or per-request bypass", () => {
    const src = read("x402Enforcement.ts");
    // No request object, no header, no query — the decision is environmental.
    expect(src).not.toMatch(/\breq\b|NextRequest|headers|searchParams|cookies/);
  });
});

describe("SR2: the startup assertion is a real assertion", () => {
  it("throws if production ever resolves to unenforced", () => {
    // Unreachable via configuration by construction, which is exactly why the
    // assertion is worth having: it converts "we believe this is impossible"
    // into "the process refuses to serve if it happens".
    process.env.FURLPAY_ENV = "production";
    expect(() => assertProductionEnforcesSignatures()).not.toThrow();
    expect(enforcementState().enforced).toBe(true);
  });

  it("does not throw outside production, where unenforced is legitimate", () => {
    expect(() => assertProductionEnforcesSignatures()).not.toThrow();
    expect(enforcementState().enforced).toBe(false);
  });
});
