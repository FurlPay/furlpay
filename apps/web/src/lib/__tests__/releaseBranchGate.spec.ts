import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script module, deliberately not part of the app build.
import { checkReleaseBranch, configuredReleaseBranch, DEFAULT_RELEASE_BRANCH } from "../../../scripts/releaseBranch.mjs";

// ---------------------------------------------------------------------------
// The production deploy branch gate.
//
// THE DEFECT. check-deploy-gate.mjs verified that CI passed for the exact HEAD
// commit — and then read the branch only to PRINT it. So `npm run deploy:prod`
// from any green feature branch shipped that branch to production, and the
// gate's own success line made it look deliberate.
//
// That is a different failure from the one the gate was written for. The
// original bug was "nobody checked CI"; this one is "CI checked the wrong
// thing": the commit was genuinely green, just not one anyone intended to
// release.
//
// Every case below is a way the gate can be wrong in the DANGEROUS direction —
// allowing a deploy it should refuse. The happy path is one test; the rest are
// refusals.
// ---------------------------------------------------------------------------

const RELEASE = DEFAULT_RELEASE_BRANCH;

/** An env with no FURLPAY_RELEASE_BRANCH key at all. */
const noOverride = {} as NodeJS.ProcessEnv;

describe("the configured release branch", () => {
  it("defaults to the branch the repo actually ships from", () => {
    // Not "main": origin/HEAD points at main, but every deploy comes from
    // extension-redesign. The default has to match reality or the gate blocks
    // the only workflow anybody uses.
    expect(configuredReleaseBranch(noOverride)).toEqual({ ok: true, branch: RELEASE });
  });

  it("honours an explicit override", () => {
    expect(configuredReleaseBranch({ FURLPAY_RELEASE_BRANCH: "main" } as NodeJS.ProcessEnv)).toEqual({
      ok: true,
      branch: "main",
    });
  });

  it("trims whitespace around an override", () => {
    const r = configuredReleaseBranch({ FURLPAY_RELEASE_BRANCH: "  main  " } as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: true, branch: "main" });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
  ])("REFUSES a %s override rather than falling back", (_label, value) => {
    // Falling back would mean `FURLPAY_RELEASE_BRANCH=` silently re-enabled the
    // default — the opposite of what clearing the variable means.
    const r = configuredReleaseBranch({ FURLPAY_RELEASE_BRANCH: value } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/set but empty/i);
  });
});

describe("which branch may deploy", () => {
  it("allows the release branch", () => {
    expect(checkReleaseBranch(RELEASE, noOverride)).toEqual({ ok: true, branch: RELEASE });
  });

  it.each([
    "feature/foo",
    "fix/urgent",
    "main",
    "extension-redesign-2",
    "Extension-Redesign",
  ])("REFUSES %s", (branch) => {
    // `main` is refused too while the default is extension-redesign — the gate
    // enforces the CONFIGURED branch, not a branch that merely sounds canonical.
    // Case-sensitive, because git refs are.
    const r = checkReleaseBranch(branch, noOverride);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(branch);
    expect(r.reason).toContain(RELEASE);
  });

  it("refuses a detached HEAD with its own message", () => {
    // `git rev-parse --abbrev-ref HEAD` literally returns "HEAD" here, which is
    // not a branch. It is the state `git checkout <sha>` leaves you in, so it
    // gets a specific remedy rather than a confusing "HEAD is not <release>".
    const r = checkReleaseBranch("HEAD", noOverride);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/detached/i);
    expect(r.remedy).toContain(`git checkout ${RELEASE}`);
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
    ["undefined", undefined],
    ["null", null],
  ])("refuses when the branch is %s", (_label, value) => {
    // git failing to report a branch must not read as "no mismatch, therefore ok".
    const r = checkReleaseBranch(value as string, noOverride);
    expect(r.ok).toBe(false);
  });

  it("follows the override, both ways", () => {
    const env = { FURLPAY_RELEASE_BRANCH: "main" } as NodeJS.ProcessEnv;
    expect(checkReleaseBranch("main", env).ok).toBe(true);
    expect(checkReleaseBranch(RELEASE, env).ok).toBe(false);
  });

  it("refuses everything when the configuration is invalid", () => {
    // Fail closed: a misconfigured gate blocks, it does not wave things through.
    const env = { FURLPAY_RELEASE_BRANCH: "" } as NodeJS.ProcessEnv;
    expect(checkReleaseBranch(RELEASE, env).ok).toBe(false);
    expect(checkReleaseBranch("anything", env).ok).toBe(false);
  });

  it("explains how to proceed rather than only refusing", () => {
    const r = checkReleaseBranch("feature/foo", noOverride);
    expect(r.remedy).toMatch(/merge/i);
    expect(r.remedy).toContain(RELEASE);
  });
});

describe("the gate actually uses it", () => {
  const GATE = readFileSync(
    join(__dirname, "..", "..", "..", "scripts", "check-deploy-gate.mjs"),
    "utf8"
  );

  it("imports and calls the check", () => {
    expect(GATE).toContain('from "./releaseBranch.mjs"');
    expect(GATE).toContain("checkReleaseBranch(branch)");
  });

  it("fails the deploy on a refusal", () => {
    // b0f56671 (audit P1-3) made a FORCED deploy — written reason, clean tree,
    // pushed HEAD, logged — the one thing allowed past the branch restriction.
    // Every unforced refusal must still stop the deploy, and nothing else may
    // bypass it.
    expect(GATE).toMatch(/if \(!release\.ok && !FORCED\) fail\(release\.reason, release\.remedy\)/);
    expect(GATE.match(/!release\.ok/g)).toHaveLength(1);
    expect(GATE).toMatch(/const FORCED = process\.env\.FURLPAY_DEPLOY_FORCE === "1";/);
  });

  it("only a forced deploy WITH a written reason can skip the branch check", () => {
    expect(GATE).toMatch(/if \(FORCED && FORCE_REASON\.length < 15\) \{\s*fail\(/);
    // The reason check runs before the branch check can be skipped.
    expect(GATE.indexOf("FORCE_REASON.length < 15")).toBeLessThan(GATE.indexOf("checkReleaseBranch(branch)"));
  });

  it("checks the branch BEFORE the network calls", () => {
    // The cheapest no. Querying the remote and GitHub Actions for a deploy that
    // was never allowed wastes time and, on a rate-limited token, can fail for
    // the wrong reason.
    const branchCheck = GATE.indexOf("checkReleaseBranch(branch)");
    const lsRemote = GATE.indexOf('"ls-remote"');
    const ghQuery = GATE.indexOf('"run",');
    expect(branchCheck).toBeGreaterThan(-1);
    expect(lsRemote).toBeGreaterThan(branchCheck);
    expect(ghQuery).toBeGreaterThan(branchCheck);
  });

  it("still verifies CI for the exact SHA", () => {
    // The pre-existing protection must survive this change: not the branch's
    // latest run, THIS commit's run, completed and successful.
    expect(GATE).toContain("r.headSha === sha");
    expect(GATE).toContain('r.status !== "completed"');
    expect(GATE).toContain('r.conclusion === "success"');
  });

  it("treats a non-success conclusion as a refusal", () => {
    // A billing-cancelled run reports conclusion "failure" with status
    // "completed", so it must not slip through as green.
    expect(GATE).toMatch(/const green = forThisSha\.find\(\(r\) => r\.conclusion === "success"\)/);
    expect(GATE).toMatch(/if \(!green\)/);
  });

  it("the override warning admits it skips the branch restriction too", () => {
    const hatch = GATE.slice(GATE.indexOf("FURLPAY_DEPLOY_FORCE"));
    expect(hatch).toMatch(/release-branch restriction is skipped/i);
  });
});
