import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * No tool attribution in the repository: no "Co-Authored-By" trailers naming
 * an AI assistant, no "Generated with ..." footers. 465 commits made between
 * 1 Jul and 5 Sep 2026 carry such a trailer; that history is published and is
 * not rewritten here. These tests stop it from growing: nothing in a tracked
 * file, and nothing in a commit made after the last affected one.
 *
 * Product copy that DISCLOSES an AI-written answer to a user ("AI-generated
 * summary. Not investment advice.") is a required label, not attribution, and
 * is deliberately not matched.
 */

const ROOT = join(process.cwd(), "..", "..");
/** The most recent commit that carries an assistant trailer. */
const LAST_AFFECTED_COMMIT = "e452cb98";

const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tryGit = (args: string[]): string | null => {
  try {
    return git(args);
  } catch {
    return null;
  }
};

// Built from parts so this file does not match its own patterns.
const TRAILER = ["Co-Authored-By:", " *Claude"].join("");
const FOOTER = ["Generated with ", "\\[?Claude Code"].join("");
const NOREPLY = ["noreply@", "anthropic\\.com"].join("");
const LINK = ["claude\\.com/", "claude-code"].join("");

describe("no tool attribution", () => {
  it("appears in no tracked file", () => {
    // `git grep` exits 1 when nothing matches, which is the passing case.
    const hits = tryGit(["grep", "-n", "-I", "-i", "-E", `${TRAILER}|${FOOTER}|${NOREPLY}|${LINK}`, "--", ".", ":!**/package-lock.json"]);
    expect(hits ?? "", "attribution boilerplate in tracked files").toBe("");
  });

  it("appears in no commit made after the last affected one", () => {
    // A shallow clone may not contain the baseline; then there is nothing to compare against.
    if (tryGit(["cat-file", "-e", `${LAST_AFFECTED_COMMIT}^{commit}`]) === null) return;
    if (tryGit(["merge-base", "--is-ancestor", LAST_AFFECTED_COMMIT, "HEAD"]) === null) return;
    const offenders = git(["log", `${LAST_AFFECTED_COMMIT}..HEAD`, "--format=%h %s", "-i", "-E", `--grep=${TRAILER}`, `--grep=${FOOTER}`, `--grep=${NOREPLY}`]).trim();
    expect(offenders, "commits carrying assistant attribution").toBe("");
  });

  it("is switched off in the repository's assistant settings", () => {
    const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
    expect(settings.attribution).toEqual({ commit: "", pr: "" });
    expect(settings.includeCoAuthoredBy).toBe(false);
  });

  it("is not asked for by the pull request template", () => {
    const template = readFileSync(join(ROOT, ".github", "pull_request_template.md"), "utf8");
    expect(template).not.toMatch(/generated with|co-authored-by/i);
  });
});
