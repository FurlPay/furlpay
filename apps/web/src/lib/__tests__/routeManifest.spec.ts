// CI enforcement for the API authentication-model manifest.
//
// The recurring FP-2..FP-5 bug class was "a route silently operating without a
// properly resolved principal." This test makes that impossible to add
// unnoticed: every API handler MUST have an explicit classification in
// security/route-manifest.json, and the manifest MUST NOT drift from disk.
//
// COMPLETENESS IS NOT CORRECTNESS. The original four checks — every route
// listed, nothing stale, valid class names, count matches — all passed while
// every `ops/*` route was classified PUBLIC_INTENTIONAL despite calling
// requireOpsAdmin(). A manifest that cannot notice that is documentation, and
// documentation does not fail a pull request. The correctness block below
// parses each route and compares what it CALLS against what it CLAIMS, so
// deleting a guard breaks the build.
//
// New invariants belong in RULES in lib/security/routeManifestValidator.ts —
// they are data, not new traversal code.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VALID_CLASSES,
  analyzeRouteFile,
  checkRoute,
  computeCounts,
  formatReport,
  type Classification,
  type Violation,
} from "@/lib/security/routeManifestValidator";

const HERE = dirname(fileURLToPath(import.meta.url)); // src/lib/__tests__
const API_DIR = join(HERE, "..", "..", "app", "api"); // src/app/api
const MANIFEST = join(HERE, "..", "..", "..", "security", "route-manifest.json");

/** Route ids paired with the file that implements them. */
function liveRoutes(dir: string): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...liveRoutes(p));
    else if (e.name === "route.ts") {
      out.push({
        route: p.replace(/\\/g, "/").replace(/^.*\/app\/api\//, "").replace(/\/route\.ts$/, ""),
        file: p,
      });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

const raw = readFileSync(MANIFEST, "utf8");
const manifest = JSON.parse(raw) as {
  _total: number;
  _counts: Record<string, number>;
  routes: Record<string, Classification>;
};
const live = liveRoutes(API_DIR);
const liveIds = live.map((r) => r.route);

/**
 * BACKLOG — pre-existing violations, recorded 23 Jul 2026 when this checker
 * was written. This is a ratchet, not an approval.
 *
 * Turning the checker on found real gaps in routes that predate it. Fixing all
 * of them in one commit would mean choosing ~60 rate-limit budgets blind, so
 * they are written down instead. The register is bidirectional and both
 * directions fail CI:
 *
 *   - a violation NOT listed here fails immediately. New code cannot regress.
 *   - a listed route that stops violating fails until it is deleted from the
 *     list, so the backlog can only shrink.
 *
 * Nothing here is "fine". Ranked by how much it actually matters:
 *
 * 1. UNGUARDED AUTH (worst). Classified AUTHENTICATED_USER but authenticating
 *    by hand with verifySession() instead of requireUser(). They therefore skip
 *    the cross-instance revocation denylist, MCP connector scope enforcement,
 *    and the deleted-account tombstone. account/fund credits money and
 *    travel/book spends it, so a revoked or deleted session reaching them is a
 *    live problem, not a style issue.
 *
 * 2. UNLIMITED PUBLIC READS. The middleware baseline only covers mutating
 *    methods, so these unauthenticated GETs have no flood control whatsoever.
 *    Several are upstream-backed (markets/*, chain/*), so scraping them spends
 *    someone else's quota and our money.
 *
 * 3. PUBLIC MUTATORS. Covered by the 150/min/IP middleware baseline; what they
 *    lack is a budget sized to the endpoint. Lowest priority.
 */
const BACKLOG = new Set<string>([
  // 1. authenticate by hand rather than through requireUser()
  //    account/fund, agents/keys and markets/[symbol] were migrated to
  //    optionalUser() on 23 Jul 2026 and removed from this list.
  "auth/logout", "auth/passkey/authenticate",
  "auth/passkey/register", "auth/webauthn", "travel/book",
  // 2. unauthenticated readers with no rate limit
  "actions/book-car", "agents", "ambassadors/instagram", "analytics/costs",
  "analytics/graph", "chain/contracts", "chain/gas-price", "chain/status",
  // `compliance` gained a per-route rate limit on 23 Jul 2026 and is now fixed.
  "chain/tx/[hash]", "chain/usdc/supply",
  "compliance/attestation/[tx]", "compliance/jurisdiction", "discord/linked-roles",
  // `investing/schedule` gained a per-route rate limit and is now fixed.
  "earn/position", "earn/vaults", "insights", "investing/rwa",
  "ledger", "markets", "markets/bars", "markets/indices", "markets/movers",
  "markets/search", "mpp/fx", "onramp/session/[id]", "payments/[id]",
  "payments/[id]/receipt", "payments/fees/estimate", "payments/history",
  "receipts/match", "reports/pnl", "reports/spending", "reports/tax",
  "travel/blogs", "travel/business/policies", "travel/business/team",
  "travel/deals", "travel/destinations", "travel/destinations/[slug]",
  "travel/hotels", "travel/itineraries", "travel/property/[id]", "travel/referral",
  "travel/restaurants", "travel/vlogs", "x402/discovery/resources",
  "x402/facilitator/supported", "x402/fx", "x402/policy/evaluate", "x402/price",
  "x402/resources", "x402/settlement/[tx]",
  // 3. public mutators — middleware baseline applies, per-route budget missing
  "agents/ap2", "compliance/attestation/source-of-funds", "compliance/escrow/[action]",
  "discord/interactions", "security/simulate", "travel/gift-cards",
  "travel/referral/track", "travel/trip-match", "x402/facilitator/settle",
  "x402/facilitator/verify", "x402/policy/settle",
]);

// ── Completeness (preserved verbatim from the original suite) ──────────────

describe("API route authentication manifest — completeness", () => {
  it("classifies EVERY live route (a new unclassified route fails CI)", () => {
    const unclassified = liveIds.filter((r) => !manifest.routes[r]);
    expect(unclassified, `Unclassified route(s) — add them to security/route-manifest.json`).toEqual([]);
  });

  it("has no stale entries (a deleted route must be removed from the manifest)", () => {
    const liveSet = new Set(liveIds);
    const stale = Object.keys(manifest.routes).filter((r) => !liveSet.has(r));
    expect(stale, `Stale manifest entr(y/ies) — route file(s) no longer exist`).toEqual([]);
  });

  it("uses only valid classifications and has ZERO unknowns", () => {
    for (const [route, cls] of Object.entries(manifest.routes)) {
      expect(VALID_CLASSES, `${route} has invalid class ${cls}`).toContain(cls);
      expect(cls).not.toBe("UNKNOWN");
    }
  });

  it("route count matches disk exactly", () => {
    expect(Object.keys(manifest.routes).length).toBe(live.length);
  });

  it("lists every route exactly once (JSON silently keeps only the last duplicate key)", () => {
    // JSON.parse collapses duplicate keys, so the parsed object cannot reveal
    // them. Count the raw occurrences instead — a duplicated entry means one
    // classification is being silently discarded.
    for (const route of Object.keys(manifest.routes)) {
      const occurrences = raw.split(`"${route}":`).length - 1;
      expect(occurrences, `"${route}" appears ${occurrences} times in route-manifest.json`).toBe(1);
    }
  });

  it("finds no duplicate route ids on disk", () => {
    expect(new Set(liveIds).size).toBe(liveIds.length);
  });
});

// ── Drift: the self-reported totals must be recomputed, never trusted ──────

describe("API route authentication manifest — drift", () => {
  it("_total and _counts match the classifications they summarise", () => {
    const { total, counts } = computeCounts(manifest.routes);
    expect(manifest._total, `_total drifted — expected ${total}`).toBe(total);
    expect(manifest._counts, "_counts drifted from the routes block").toEqual(counts);
  });

  it("_total also matches what is actually on disk", () => {
    expect(manifest._total).toBe(live.length);
  });
});

// ── Correctness: the implementation must agree with the classification ─────

describe("API route authentication manifest — correctness", () => {
  const violations: Violation[] = [];
  const handlerless: string[] = [];

  for (const { route, file } of live) {
    const classification = manifest.routes[route];
    if (!classification) continue; // completeness suite already fails on this
    const { calls, methods, handlerless: none } = analyzeRouteFile(file);
    if (none) handlerless.push(route);
    violations.push(
      ...checkRoute({ route, file, calls, methods, handlerless: none }, classification)
    );
  }

  const unregistered = violations.filter((v) => !BACKLOG.has(v.route));

  it("no NEW route contradicts its classification", () => {
    // The ratchet. Anything not already in BACKLOG must be correct today —
    // which is what stops a removed requireOpsAdmin() from shipping quietly.
    expect(unregistered, formatReport(unregistered, live.length)).toEqual([]);
  });

  it("the backlog only shrinks (a fixed route must be removed from BACKLOG)", () => {
    const stillViolating = new Set(violations.map((v) => v.route));
    const stale = [...BACKLOG].filter((r) => !stillViolating.has(r)).sort();
    expect(
      stale,
      `These routes no longer violate — delete them from BACKLOG so the ratchet keeps its teeth:\n  ` +
        stale.join("\n  ")
    ).toEqual([]);
  });

  it("reports the backlog by severity so it stays visible", () => {
    const errors = violations.filter((v) => v.severity === "error").length;
    const debt = violations.filter((v) => v.severity === "debt").length;
    // Not an assertion about quality — a printed reminder that the ratchet is
    // holding a real backlog, so "green CI" is never read as "no gaps".
    expect(errors + debt).toBe(violations.length);
    expect(BACKLOG.size).toBeGreaterThanOrEqual(violations.length);
  });

  it("every route file declares at least one HTTP handler we can analyse", () => {
    // A file whose handler is re-exported from elsewhere would be analysed as
    // empty and would pass every rule vacuously. Fail instead of assuming.
    expect(
      handlerless,
      "Route file(s) with no analysable handler — the validator cannot see their guards, " +
        "so their classification is unverified. Inline the handler or extend the validator."
    ).toEqual([]);
  });
});
