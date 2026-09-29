import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createApiKey,
  verifyApiKey,
  API_SCOPES,
  PUBLISHABLE_SCOPES,
  type ApiScope,
} from "@/lib/apiKeys";

// ---------------------------------------------------------------------------
// What an API key's scopes actually mean on this API.
//
// THE BEHAVIOUR THESE TESTS PIN, stated plainly because it surprises people:
//
//   sk_  SECRET       — receives EVERY scope, whatever was requested.
//   rk_  RESTRICTED   — receives exactly the scopes requested, and nothing else.
//   pk_  PUBLISHABLE  — receives only PUBLISHABLE_SCOPES, whatever was requested.
//
// So `agents:manage` vs `payments:read` on a control-plane route is a REAL
// distinction for `rk` credentials and NO distinction at all for `sk` ones. An
// operator who creates a secret key "restricted" to `payments:read` gets one
// that can issue mandates and attest recipients.
//
// IS THAT A BUG? No — it is the deliberate three-tier model this API is built
// on, the same one it takes its prefixes from: a secret key is the full-access
// credential by definition, and `rk` exists precisely so that a restricted
// credential is available. The failure mode would be believing otherwise, which
// is why it is written down here and enforced by tests rather than living in a
// single comment inside `normalizeScopes`.
//
// WHAT WOULD MAKE IT A BUG, and what these tests therefore guard:
//   · a route that only works because it assumed `sk` was restricted;
//   · `rk` enforcement being incomplete, which would leave NO restricted
//     credential at all;
//   · `PUBLISHABLE_SCOPES` quietly gaining a scope that moves money, since a
//     publishable key is world-readable by definition.
// ---------------------------------------------------------------------------

const WEB = join(__dirname, "..", "..", "..");
const API_V1 = join(WEB, "src", "app", "api", "v1");

describe("issuance: what each prefix actually stores", () => {
  it("sk receives every scope, regardless of what was requested", async () => {
    const created = await createApiKey({
      userId: "u_sk",
      name: "narrow on paper",
      prefix: "sk",
      environment: "test",
      // Deliberately the narrowest possible request.
      scopes: ["payments:read"],
    });
    expect([...created.record.scopes].sort()).toEqual([...API_SCOPES].sort());
  });

  it("rk receives exactly the scopes requested", async () => {
    const created = await createApiKey({
      userId: "u_rk",
      name: "genuinely restricted",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:read", "agents:read"],
    });
    expect([...created.record.scopes].sort()).toEqual(["agents:read", "payments:read"]);
  });

  it("pk is filtered down to the publishable set", async () => {
    const created = await createApiKey({
      userId: "u_pk",
      name: "browser key",
      prefix: "pk",
      environment: "test",
      // Asking for money-moving scopes on a world-readable credential.
      scopes: ["payments:read", "payments:create", "agents:manage"],
    });
    expect(created.record.scopes).toEqual(["payments:read"]);
  });

  it("a publishable key can never hold a scope that moves money or reads private data", () => {
    // Guards the list itself, not a key. A publishable key ships in a browser,
    // so anything added here is added to the public internet.
    for (const scope of PUBLISHABLE_SCOPES) {
      expect(scope.endsWith(":read"), `${scope} is publishable but is not a read scope`).toBe(true);
    }
    expect(PUBLISHABLE_SCOPES).not.toContain("transactions:read" as ApiScope);
    expect(PUBLISHABLE_SCOPES).not.toContain("ledger:read" as ApiScope);
    expect(PUBLISHABLE_SCOPES).not.toContain("wallets:read" as ApiScope);
  });
});

describe("enforcement: verifyApiKey applies the stored set uniformly", () => {
  it("accepts an rk key holding the required scope", async () => {
    const k = await createApiKey({
      userId: "u_rk2",
      name: "rk",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:read"],
    });
    const auth = await verifyApiKey(k.secret, { requiredScope: "payments:read" });
    expect(auth.ok).toBe(true);
  });

  it("refuses an rk key missing the required scope", async () => {
    const k = await createApiKey({
      userId: "u_rk3",
      name: "rk",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:read"],
    });
    const auth = await verifyApiKey(k.secret, { requiredScope: "agents:manage" });
    expect(auth.ok).toBe(false);
    expect(auth.ok === false && auth.reason).toBe("insufficient_scope");
  });

  it("rk enforcement is COMPLETE: every scope in the registry is deniable", async () => {
    // If any scope could not be withheld, there would be no way to issue a
    // credential restricted against it — and a "restricted key" that cannot
    // restrict one particular permission is a trap.
    const k = await createApiKey({
      userId: "u_rk4",
      name: "empty",
      prefix: "rk",
      environment: "test",
      scopes: [],
    });
    for (const scope of API_SCOPES) {
      const auth = await verifyApiKey(k.secret, { requiredScope: scope });
      expect(auth.ok, `${scope} was granted to a key holding no scopes`).toBe(false);
    }
  });

  it("an sk key passes EVERY scope check — the blast radius, measured", async () => {
    // Not an aspiration: this is what a leaked secret key can do. Enumerated so
    // the number is visible rather than implied.
    const k = await createApiKey({
      userId: "u_sk2",
      name: "sk",
      prefix: "sk",
      environment: "test",
      scopes: ["payments:read"],
    });
    for (const scope of API_SCOPES) {
      const auth = await verifyApiKey(k.secret, { requiredScope: scope });
      expect(auth.ok, `sk was refused ${scope}`).toBe(true);
    }
  });
});

describe("no control-plane route relies on sk being restricted", () => {
  /** Every `requireTenant(req, "<scope>")` in the v1 tree. */
  function requiredScopes(): { route: string; scope: string }[] {
    const found: { route: string; scope: string }[] = [];
    (function walk(dir: string, prefix: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full, prefix ? `${prefix}/${entry}` : entry);
        } else if (entry === "route.ts") {
          const src = readFileSync(full, "utf8");
          for (const m of src.matchAll(/requireTenant\(\s*req\s*,\s*"([a-z:]+)"/g)) {
            found.push({ route: prefix || ".", scope: m[1] });
          }
        }
      }
    })(API_V1, "");
    return found;
  }

  const required = requiredScopes();

  it("finds the routes — the control for everything below", () => {
    expect(required.length).toBeGreaterThanOrEqual(10);
  });

  it("every scope a route demands is one the registry can actually grant", () => {
    // A route requiring a scope outside API_SCOPES would be permanently 403 for
    // every credential, including sk — an endpoint nobody can call.
    for (const { route, scope } of required) {
      expect(
        (API_SCOPES as readonly string[]).includes(scope),
        `${route} requires "${scope}", which is not in API_SCOPES`
      ).toBe(true);
    }
  });

  it("an sk credential can reach every control-plane route", async () => {
    // This is the documentation-as-test: the scope annotations on these routes
    // are meaningful for `rk` and decorative for `sk`, and that is intentional.
    // If this ever fails, the scope model changed and every caller holding an
    // sk key is affected.
    const k = await createApiKey({
      userId: "u_sk3",
      name: "sk",
      prefix: "sk",
      environment: "test",
      scopes: [],
    });
    for (const { route, scope } of required) {
      const auth = await verifyApiKey(k.secret, { requiredScope: scope as ApiScope });
      expect(auth.ok, `sk could not reach ${route} (needs ${scope})`).toBe(true);
    }
  });

  it("an rk credential scoped to reads cannot reach any mutating route", async () => {
    // The converse, and the reason `rk` is worth having: least privilege is
    // genuinely available on this API, just not through `sk`.
    const k = await createApiKey({
      userId: "u_rk5",
      name: "reader",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:read", "agents:read", "ledger:read"],
    });
    const mutating = required.filter(
      (r) => r.scope === "agents:manage" || r.scope === "payments:create"
    );
    expect(mutating.length).toBeGreaterThan(0);
    for (const { route, scope } of mutating) {
      const auth = await verifyApiKey(k.secret, { requiredScope: scope as ApiScope });
      expect(auth.ok, `a read-only rk key reached ${route}`).toBe(false);
    }
  });
});
