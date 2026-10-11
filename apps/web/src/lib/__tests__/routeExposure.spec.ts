import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listPayments } from "@/lib/services/payments";

/*
 * The route manifest classifies a HANDLER by the guard it carries. Whether an
 * anonymous caller can actually reach it is decided somewhere else: the
 * middleware's public prefix list. For 28 routes the two disagreed — the
 * manifest said PUBLIC_INTENTIONAL, the middleware required a session — and
 * the gap hid two real defects:
 *
 *   - GET /api/payments/history had no guard of its own and listed EVERY
 *     account's payments to any signed-in caller.
 *   - GET /api/security/lock is session-less by design (the emailed "lock my
 *     account" link for a takeover victim) and the middleware answered 401.
 *
 * These tests make the disagreement explicit and reviewable: a route that is
 * public in the manifest but session-gated by the middleware has to be named
 * below, with the reason it is safe for any signed-in user to call.
 */

const WEB = process.cwd();
const middleware = readFileSync(join(WEB, "src", "middleware.ts"), "utf8");
const manifest: Record<string, string> = JSON.parse(readFileSync(join(WEB, "security", "route-manifest.json"), "utf8")).routes;

function publicApiPrefixes(): string[] {
  const start = middleware.indexOf("const PUBLIC_API_PREFIXES = [");
  const end = middleware.indexOf("];", start);
  expect(start, "PUBLIC_API_PREFIXES not found in middleware.ts").toBeGreaterThan(-1);
  return [...middleware.slice(start, end).matchAll(/^\s*"(\/api[^"]*)"/gm)].map((m) => m[1]);
}
const prefixes = publicApiPrefixes();
const anonymous = (route: string) => prefixes.some((p) => `/api/${route}`.startsWith(p));

/**
 * PUBLIC_INTENTIONAL in the manifest, but a session is required in practice.
 * Each entry says why any signed-in account may call it: it returns nothing
 * account-specific, or it carries its own narrower gate.
 */
const SESSION_GATED_BY_MIDDLEWARE: Record<string, string> = {
  "analytics/costs": "aggregate infrastructure cost estimate; no account data",
  "app/config": "client configuration; no account data",
  "banking/directory": "static bank directory; no account data",
  compliance: "handler resolves the session itself for account-specific output",
  "compliance/attestation/[tx]": "reads a public on-chain attestation by transaction id",
  "compliance/attestation/source-of-funds": "handler requires the compliance operator credential",
  "compliance/escrow/[action]": "handler requires the compliance operator credential",
  "compliance/jurisdiction": "jurisdiction rules; handler resolves the caller itself",
  "compliance/travel-rule": "pure computation over the request body; sends nothing",
  "earn/position": "not account-scoped in this build; earn is not a live product",
  "earn/vaults": "static vault catalogue",
  "flags/client": "client flag state; handler resolves the caller itself",
  "investing/rwa": "catalogue; handler carries its own feature gate",
  "investing/schedule": "handler carries its own gate; recurring investing cannot be enabled",
  "membership/plans": "static plan catalogue",
  "p2p/ads": "handler carries its own gate; P2P cannot be enabled",
  "p2p/ads/[id]": "handler carries its own gate; P2P cannot be enabled",
  "p2p/config": "static configuration",
  "p2p/quote": "pure computation over the request body",
  "payments/[id]": "reduced public view by unguessable id, for the payment link holder",
  "payments/[id]/receipt": "reduced public receipt by unguessable id, for the payment link holder",
  "payouts/validate-destination": "pure validation of the string in the request body; stores nothing",
  "properties/capabilities": "static capability list",
  "security/address-check": "pure check of the address in the request body",
  "security/simulate": "simulates the transaction in the request body; stores nothing",
  "transfers/sponsored": "configuration presence only; no addresses or secrets",
};

describe("manifest classification vs middleware exposure", () => {
  it("names every route that is public in the manifest but session-gated by the middleware", () => {
    const gated = Object.entries(manifest)
      .filter(([route, cls]) => cls === "PUBLIC_INTENTIONAL" && !anonymous(route))
      .map(([route]) => route)
      .sort();
    expect(gated, "a PUBLIC_INTENTIONAL route is session-gated by the middleware and not reviewed here").toEqual(Object.keys(SESSION_GATED_BY_MIDDLEWARE).sort());
  });

  it("gives a reason for each one", () => {
    for (const [route, reason] of Object.entries(SESSION_GATED_BY_MIDDLEWARE)) {
      expect(reason.length, `${route} has no stated reason`).toBeGreaterThan(15);
      expect(existsSync(join(WEB, "src", "app", "api", ...route.split("/"), "route.ts")), `${route} has no route.ts`).toBe(true);
    }
  });

  it("does not let an authenticated-only class be reachable without its own guard", () => {
    // A route under a public prefix is reachable anonymously, so if its class
    // says it needs a user, the handler itself must do the check.
    const GUARD = /requireUser|requireRole|requireAnyRole|requireOpsAdmin|requireOps\b|requireApiKey|requireOperator|authenticateRampRequest|verifiedTelegramRequest|requireStepUp|optionalUser|requireCron|tokenFromRequest|getSessionClaims|verifySession/;
    const missing: string[] = [];
    for (const [route, cls] of Object.entries(manifest)) {
      if (cls !== "AUTHENTICATED_USER" && cls !== "ADMIN_ONLY") continue;
      if (!anonymous(route)) continue;
      const file = join(WEB, "src", "app", "api", ...route.split("/"), "route.ts");
      if (existsSync(file) && !GUARD.test(readFileSync(file, "utf8"))) missing.push(route);
    }
    expect(missing, "reachable without a session and no guard in the handler").toEqual([]);
  });
});

describe("the two defects the mismatch was hiding", () => {
  it("classifies the payment history route as authenticated, with a handler-level guard", () => {
    expect(manifest["payments/history"]).toBe("AUTHENTICATED_USER");
    const src = readFileSync(join(WEB, "src", "app", "api", "payments", "history", "route.ts"), "utf8");
    expect(src).toContain("requireUser(req)");
    expect(src).toContain("listPayments(auth.account.user.id, limit)");
  });

  it("scopes the API-key payments listing to the key's owner", () => {
    const src = readFileSync(join(WEB, "src", "app", "api", "v1", "payments", "route.ts"), "utf8");
    expect(src).toContain("listPayments(auth.record.userId, limit)");
  });

  it("cannot list payments without naming whose they are", () => {
    // @ts-expect-error the owner is required: the unscoped call no longer compiles
    expect(() => listPayments()).not.toThrow();
    expect(listPayments("")).toEqual([]);
    expect(listPayments("user-with-no-payments")).toEqual([]);
  });

  it("lets the emailed account-lock link through the middleware without a session", () => {
    expect(anonymous("security/lock")).toBe(true);
    // ...and only that route: its siblings stay session-gated.
    for (const sibling of ["security/mfa", "security/scan", "security/env", "security/address-check", "security/simulate"]) {
      expect(anonymous(sibling), `${sibling} must not be anonymous`).toBe(false);
    }
    const src = readFileSync(join(WEB, "src", "app", "api", "security", "lock", "route.ts"), "utf8");
    expect(src).toContain("verifyLockToken(");
    expect(src).toContain("rateLimitOr429(");
  });
});
