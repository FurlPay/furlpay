// ---------------------------------------------------------------------------
// Which branch may deploy to production.
//
// WHY THIS EXISTS. check-deploy-gate.mjs verified that CI passed for the exact
// HEAD commit, but it read the branch with `git rev-parse --abbrev-ref HEAD` and
// then only ever PRINTED it. So a green feature branch satisfied the gate:
// `npm run deploy:prod` from `feature/anything` shipped that branch to
// production, and the gate's own output made it look deliberate.
//
// That is a different failure from the one the gate was built for. The original
// bug was "nobody checked CI"; this one is "CI checked the wrong thing" — the
// commit was genuinely green, just not a commit anyone intended to release.
//
// Pure decision logic, separated from the script so it can be tested without a
// git repo, a network, or the GitHub CLI. The script supplies the facts; this
// decides.
// ---------------------------------------------------------------------------

/** The branch production ships from, unless the repo overrides it. */
export const DEFAULT_RELEASE_BRANCH = "extension-redesign";

/**
 * The configured release branch.
 *
 * `FURLPAY_RELEASE_BRANCH` is the single source of truth, so the day the repo
 * moves back to `main` this changes in one place rather than in a script, a
 * workflow and a runbook that then disagree.
 *
 * An EMPTY or whitespace-only override is rejected rather than ignored: falling
 * back to the default there would mean `FURLPAY_RELEASE_BRANCH=` silently
 * re-enabled the default branch, which is the opposite of what someone clearing
 * the variable intends.
 */
export function configuredReleaseBranch(env = process.env) {
  if (!("FURLPAY_RELEASE_BRANCH" in env)) return { ok: true, branch: DEFAULT_RELEASE_BRANCH };

  const raw = env.FURLPAY_RELEASE_BRANCH;
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      reason: "FURLPAY_RELEASE_BRANCH is set but empty",
      remedy:
        "Set it to a branch name, or unset it entirely to use the default " +
        `(${DEFAULT_RELEASE_BRANCH}). An empty value is refused rather than ignored, ` +
        "so clearing it cannot silently re-enable the default.",
    };
  }
  return { ok: true, branch: raw.trim() };
}

/**
 * May `currentBranch` deploy to production?
 *
 * `currentBranch` is whatever `git rev-parse --abbrev-ref HEAD` returned. On a
 * detached HEAD that string is literally "HEAD", which is NOT a branch — and is
 * exactly the state a `git checkout <sha>` leaves you in, so it gets its own
 * message rather than the generic mismatch one.
 */
export function checkReleaseBranch(currentBranch, env = process.env) {
  const configured = configuredReleaseBranch(env);
  if (!configured.ok) return { ok: false, reason: configured.reason, remedy: configured.remedy };

  const release = configured.branch;

  if (!currentBranch || typeof currentBranch !== "string" || currentBranch.trim() === "") {
    return {
      ok: false,
      reason: "the current branch could not be determined",
      remedy: `Check out ${release} and retry. A deploy from an unknown branch is not a deploy anyone can trace.`,
    };
  }

  const current = currentBranch.trim();

  if (current === "HEAD") {
    return {
      ok: false,
      reason: "HEAD is detached — you are not on a branch",
      remedy: `Run: git checkout ${release}`,
    };
  }

  if (current !== release) {
    return {
      ok: false,
      reason: `production deploys only from ${release}, and HEAD is on ${current}`,
      remedy:
        `Merge ${current} into ${release} and deploy from there.\n  ` +
        "Shipping a feature branch straight to production means the deployed commit is " +
        "not on the branch anybody reviews, bisects or rolls back to.",
    };
  }

  return { ok: true, branch: release };
}
