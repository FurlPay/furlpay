import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs script, no type declarations
import { deployArgs } from "../../../../scripts/deploy-prod.mjs";

const SHA = "0dce509b046e377754df466b69a45d14e9435d42";

describe("deploy:prod stamps release identity", () => {
  const args: string[] = deployArgs({ sha: SHA, branch: "extension-redesign", time: "2026-10-11T18:00:00.000Z" });

  it("deploys to production non-interactively", () => {
    expect(args.slice(0, 4)).toEqual(["vercel", "deploy", "--prod", "--yes"]);
  });

  it("passes the commit to the build AND the runtime (buildInfo reads process.env when serving)", () => {
    for (const flag of ["--build-env", "--env"]) {
      expect(args).toContain(flag);
      const values = args.filter((_, i) => args[i - 1] === flag);
      expect(values).toEqual([`FURLPAY_BUILD_SHA=${SHA}`, "FURLPAY_BUILD_BRANCH=extension-redesign", "FURLPAY_BUILD_TIME=2026-10-11T18:00:00.000Z"]);
    }
  });

  it("records git metadata on the deployment for vercel inspect", () => {
    expect(args).toContain(`gitCommitSha=${SHA}`);
    expect(args).toContain("gitCommitRef=extension-redesign");
  });

  it("refuses a short SHA, an odd branch name or a bad time rather than stamping nonsense", () => {
    expect(() => deployArgs({ sha: "0dce509b", branch: "x", time: "2026-10-11T00:00:00Z" })).toThrow();
    expect(() => deployArgs({ sha: SHA, branch: "a b; rm -rf /", time: "2026-10-11T00:00:00Z" })).toThrow();
    expect(() => deployArgs({ sha: SHA, branch: "x", time: "never" })).toThrow();
  });
});
