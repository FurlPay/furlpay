import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EPOCH_OUTDATED,
  REVOCATION_HEADER,
  epochMatches,
  epochOf,
} from "../sessionEpoch";

// ---------------------------------------------------------------------------
// Session epoch — "sign out everywhere" in O(1).
//
// The comparison logic is tiny and the consequences of getting it wrong are
// asymmetric in both directions, which is what these tests are about:
//
//   too strict  -> the user is locked out of their own account
//   too lax     -> a revoked token keeps working, which is the whole point lost
//
// The single most important test in this file is the LOCKOUT one: a token minted
// AFTER a bump must carry the new epoch. Without that, revocation would log the
// owner out permanently and no amount of re-authentication would help.
// ---------------------------------------------------------------------------

const acct = (sessionEpoch?: number) => ({ user: { security: { sessionEpoch } } });

describe("epochOf — defaults", () => {
  it("treats a missing epoch as 1", () => {
    // Accounts created before this feature have no epoch. Defaulting to anything
    // other than the token default would revoke every live session on deploy.
    expect(epochOf(acct(undefined))).toBe(1);
  });

  it("reads a real epoch", () => {
    expect(epochOf(acct(7))).toBe(7);
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("falls back to 1 on a corrupt value (%s)", (_label, value) => {
    // A corrupted row must not become an epoch that no token can ever match —
    // that is a permanent lockout written into the database.
    expect(epochOf(acct(value as number))).toBe(1);
  });
});

describe("epochMatches — the rollout must not sign anyone out", () => {
  it("a legacy token against a legacy account matches", () => {
    // Both sides absent: every session alive at deploy time keeps working.
    expect(epochMatches(undefined, acct(undefined))).toBe(true);
  });

  it("a legacy token against a bumped account does NOT match", () => {
    // This is the revocation doing its job: tokens minted before the bump die.
    expect(epochMatches(undefined, acct(2))).toBe(false);
  });

  it("a token stamped 1 matches a never-bumped account", () => {
    expect(epochMatches(1, acct(undefined))).toBe(true);
  });

  it("matching epochs pass", () => {
    expect(epochMatches(3, acct(3))).toBe(true);
  });

  it("an older token fails", () => {
    expect(epochMatches(2, acct(3))).toBe(false);
  });

  it("a FORGED HIGHER epoch also fails", () => {
    // Equality, not `>=`. A caller who could mint or edit a claim must not be
    // able to outrun revocation by claiming a future epoch.
    expect(epochMatches(99, acct(3))).toBe(false);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("a corrupt claim (%s) is treated as 1", (_label, value) => {
    expect(epochMatches(value as number, acct(1))).toBe(true);
    expect(epochMatches(value as number, acct(2))).toBe(false);
  });
});

describe("the lockout regression", () => {
  // After a bump the account sits at 2. A fresh login that forgot to stamp the
  // epoch would default to 1, fail this comparison, and reject the user on the
  // request right after a SUCCESSFUL sign-in — with no way out, because every
  // retry logs in and is rejected again.
  it("an unstamped fresh token would be rejected by a bumped account", () => {
    expect(epochMatches(undefined, acct(2))).toBe(false);
  });

  it("a correctly stamped fresh token is accepted", () => {
    expect(epochMatches(2, acct(2))).toBe(true);
  });

  it("every login path stamps the epoch", () => {
    // Asserted against the source, because this is the property that prevents
    // the lockout above and it is easy to forget when adding a provider.
    const root = join(__dirname, "..", "..", "app", "api", "auth");
    const loginRoutes = [
      "otp/check/route.ts",
      "google/route.ts",
      "apple/route.ts",
      "native/exchange/route.ts",
      "passkey/authenticate/route.ts",
      "passkey/register/route.ts",
      "guest/route.ts",
    ];
    for (const rel of loginRoutes) {
      const src = readFileSync(join(root, ...rel.split("/")), "utf8");
      expect(src, `${rel} mints a session without stamping sepoch`).toContain("sepoch:");
      expect(src, `${rel} should use currentEpoch()`).toContain("currentEpoch(");
    }
  });

  it("refresh carries the token's own epoch rather than re-reading the account", () => {
    // Re-stamping from the account inside refresh would launder a stale token
    // into a valid one — the opposite of revocation.
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "api", "auth", "refresh", "route.ts"),
      "utf8"
    );
    expect(src).toContain("sepoch: claims.sepoch");
    expect(src).not.toContain("sepoch: await currentEpoch");
  });
});

describe("enforcement is wired into the authorization path", () => {
  const authz = readFileSync(join(__dirname, "..", "authz.ts"), "utf8");

  it("requireUser checks the epoch", () => {
    expect(authz).toContain("epochMatches(claims.sepoch, account)");
  });

  it("checks it only after the account is resolved", () => {
    // The comparison needs the account, so it must come after the lookup and
    // after the deleted/locked guards.
    const lookup = authz.indexOf("getAccountDurable(claims.sub)");
    const check = authz.indexOf("epochMatches(claims.sepoch, account)");
    expect(lookup).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(lookup);
  });

  it("answers 401 with a machine-readable reason", () => {
    // A client must be able to tell revocation from a transient failure, so it
    // clears its token instead of retrying forever.
    // authz.ts references the CONSTANTS, so match the identifiers there and pin
    // their values here — matching the literal string in the source would fail
    // for the right code.
    expect(authz).toContain("REVOCATION_HEADER");
    expect(authz).toContain("EPOCH_OUTDATED");
    expect(REVOCATION_HEADER).toBe("X-Revocation-Reason");
    expect(EPOCH_OUTDATED).toBe("session_epoch_outdated");
  });
});

describe("the epoch is durable, not a TTL'd counter", () => {
  const src = readFileSync(join(__dirname, "..", "sessionEpoch.ts"), "utf8");

  it("does not store the epoch in KV", () => {
    // kvIncr in this codebase takes a WINDOW and sets a TTL (it exists for rate
    // limiting). An epoch that expires silently REVIVES every token it revoked.
    //
    // Comments are stripped first: sessionEpoch.ts EXPLAINS the kvIncr trap by
    // name, so a naive text search trips over the very documentation that warns
    // against it — and a test that fails on its own comment is one people learn
    // to ignore. What matters is that no KV call is reachable in the code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "@\/lib\/kv"/);
    expect(code).not.toMatch(/\bkvIncr\s*\(/);
    expect(code).not.toMatch(/\bkvSet\s*\(/);
  });

  it("persists the bump before returning", () => {
    // A bump lost to a failed write is a revocation the user was told happened.
    const bump = src.slice(src.indexOf("export async function bumpSessionEpoch"));
    const assign = bump.indexOf("sessionEpoch = next");
    const persist = bump.indexOf("persistAccount");
    expect(assign).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(assign);
  });

  it("reads durably before incrementing", () => {
    // Bumping a stale in-memory copy on a cold instance would LOWER the epoch
    // and un-revoke tokens.
    const bump = src.slice(src.indexOf("export async function bumpSessionEpoch"));
    expect(bump).toContain("getAccountDurable(userId)");
  });
});

describe("disabling MFA ends sessions elsewhere", () => {
  const route = readFileSync(
    join(__dirname, "..", "..", "app", "api", "security", "mfa", "route.ts"),
    "utf8"
  );
  const disable = route.slice(route.indexOf('if (body.action === "disable")'));

  it("bumps the epoch", () => {
    expect(disable).toContain("bumpAndReissue");
  });

  it("bumps only after the second factor is proven", () => {
    const proof = disable.indexOf("if (!proof.ok)");
    const bump = disable.indexOf("bumpAndReissue");
    expect(proof).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(proof);
  });

  it("re-issues a cookie so the acting device stays signed in", () => {
    // Otherwise the tab that just proved possession of the second factor is
    // logged out — no security gain, and it reads as a crash.
    // d3d7422e moved this to the request-aware helper (embedded Telegram
    // sessions need different cookie attributes); the re-issue itself stands.
    expect(route).toContain("setSessionCookieForRequest(req, res, token)");
  });

  it("does not extend auth_time when re-issuing", () => {
    // This was a factor check, not a fresh identity proof, so it must not extend
    // how long the session may keep sliding via /api/auth/refresh.
    expect(route).toContain("auth_time: claims.auth_time");
  });

  it("records the revocation in the audit trail", () => {
    expect(disable).toContain("sessionsRevoked: true");
  });
});
