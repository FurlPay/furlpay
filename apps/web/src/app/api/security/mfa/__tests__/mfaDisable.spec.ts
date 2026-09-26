import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// MFA downgrade protection.
//
// THE DEFECT THIS PINS: `action: "disable"` used to flip `totpEnabled` to false
// on nothing but a session cookie. That made the second factor removable with
// only the FIRST factor — anyone holding a stolen session (XSS, a borrowed
// laptop, a lifted cookie) could strip MFA and keep long-term access, which is
// the precise attack MFA is bought to prevent. It was also silent: the secret
// stayed in place, so a later re-enable looked like nothing had happened.
//
// Source-level assertions, because invoking the handler needs a signed session,
// a hydrated account store and a persistence layer — and the property here is
// "no path reaches the state change without proof", which is a property of the
// code's shape. The recovery-code primitive itself is tested behaviourally in
// lib/__tests__/mfaRecovery.spec.ts.
// ---------------------------------------------------------------------------

const ROUTE = readFileSync(join(__dirname, "..", "route.ts"), "utf8");

/** The body of one `if (body.action === "...")` block. */
function actionBlock(action: string): string {
  const start = ROUTE.indexOf(`if (body.action === "${action}")`);
  expect(start, `no handler for action "${action}"`).toBeGreaterThan(-1);
  const rest = ROUTE.slice(start);
  const next = rest.slice(1).search(/\n {2}if \(body\.action|\n {2}return NextResponse\.json\(\{ error: "Unknown/);
  return rest.slice(0, next > 0 ? next : rest.length);
}

describe("disabling MFA requires the second factor", () => {
  const block = actionBlock("disable");

  it("verifies a factor before changing state", () => {
    expect(block).toContain("verifySecondFactor(sec, body.code)");
    // The guard returns before the mutation — not after it.
    const guardAt = block.indexOf("if (!proof.ok)");
    const mutateAt = block.indexOf("sec.totpEnabled = false");
    expect(guardAt).toBeGreaterThan(-1);
    expect(mutateAt).toBeGreaterThan(guardAt);
  });

  it("rejects with 401 and audits the attempt", () => {
    expect(block).toContain("auth.mfa_failed");
    expect(block).toContain("proof.status");
  });

  it("clears the secret and the recovery codes, not just the flag", () => {
    // A disabled factor whose material is still stored is a credential nobody
    // is watching.
    expect(block).toContain('sec.totpSecret = ""');
    expect(block).toContain("sec.totpRecoveryCodes = []");
  });

  it("records which factor authorised the change", () => {
    expect(block).toContain("via: proof.via");
  });
});

describe("regenerating recovery codes requires the second factor", () => {
  const block = actionBlock("regenerate-recovery");

  it("verifies before minting a replacement set", () => {
    // Replacing codes invalidates the old set, so it is a credential change.
    const guardAt = block.indexOf("verifySecondFactor(sec, body.code)");
    const mintAt = block.indexOf("generateRecoveryCodes()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(mintAt).toBeGreaterThan(guardAt);
  });

  it("refuses when MFA is not enabled", () => {
    expect(block).toContain("if (!sec.totpEnabled)");
  });
});

describe("the second-factor helper", () => {
  it("accepts a live TOTP code or a single-use recovery code", () => {
    expect(ROUTE).toContain("verifyTotp(sec.totpSecret, code)");
    expect(ROUTE).toContain("consumeRecoveryCode(code, sec.totpRecoveryCodes)");
  });

  it("persists the shrunken set after a recovery code is spent", () => {
    // A consumed code that survives a failed write is replayable.
    expect(ROUTE).toContain("sec.totpRecoveryCodes = consumed.remaining");
  });

  it("gives one error for both failure modes", () => {
    // Distinct messages would tell an attacker which factor to attack.
    // Bound to the helper itself: slicing to end-of-file would also pick up the
    // verify action's own "Invalid code", which is a different check.
    const helperStart = ROUTE.indexOf("function verifySecondFactor");
    const helper = ROUTE.slice(helperStart, ROUTE.indexOf("\n}", helperStart));
    const invalid = [...helper.matchAll(/error: "Invalid code"/g)];
    expect(invalid).toHaveLength(1);
    expect(helper).not.toMatch(/recovery cod\w* (are|is) (not )?(set|available|configured)/i);
  });

  it("requires a code at all", () => {
    expect(ROUTE).toMatch(/if \(!code\)[\s\S]{0,200}status: 400/);
  });
});

describe("secrets never leave the server", () => {
  it("GET returns a COUNT of recovery codes, never the codes or hashes", () => {
    const get = ROUTE.slice(ROUTE.indexOf("export async function GET"), ROUTE.indexOf("export async function POST"));
    expect(get).toContain("recoveryCodesRemaining");
    expect(get).not.toContain("totpRecoveryCodes:");
    expect(get).not.toContain("totpSecret");
  });

  it("plaintext codes appear only where the owner is minting them", () => {
    // `recoveryCodes:` (the plaintext array) may only be returned by verify and
    // regenerate-recovery — the two flows where the user is present and expecting
    // them.
    // Negative lookahead excludes `recoveryCodes: codes.length`, which is an
    // audit COUNT and not the plaintext array.
    const occurrences = [...ROUTE.matchAll(/recoveryCodes: codes(?!\.)/g)];
    expect(occurrences).toHaveLength(2);
  });

  it("stores hashes, never plaintext", () => {
    expect(ROUTE).toContain("sec.totpRecoveryCodes = hashes");
    expect(ROUTE).not.toContain("sec.totpRecoveryCodes = codes");
  });
});
