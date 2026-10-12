import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The tenancy wrapper, pinned.
//
// WHY THIS SUITE EXISTS. `requireTenant` was added to the route-manifest
// validator's accepted calls for API_KEY_AUTHENTICATED. That is only honest if
// the wrapper really does verify the credential — otherwise adding the name
// would be a way to satisfy the rule by indirection, which is the exact thing
// the rule exists to catch.
//
// So these tests pin the wrapper's contract at the source level: it must call
// requireApiKey, it must do so FIRST, and it must never take the tenant from
// anything a caller controls.
// ---------------------------------------------------------------------------

const LIB = join(__dirname, "..");
const src = readFileSync(join(LIB, "tenancy.ts"), "utf8");

describe("requireTenant is a real credential check, not a bypass", () => {
  it("calls requireApiKey", () => {
    expect(src).toContain("requireApiKey(req");
  });

  it("calls it BEFORE any other work, and returns on failure", () => {
    const fnStart = src.indexOf("export async function requireTenant");
    const body = src.slice(fnStart);
    const authAt = body.indexOf("requireApiKey(req");
    const orgAt = body.indexOf("organizationOwnedBy(");
    expect(authAt).toBeGreaterThan(-1);
    expect(orgAt).toBeGreaterThan(-1);
    // The organization is never looked up for an unauthenticated caller.
    expect(authAt).toBeLessThan(orgAt);
    expect(body).toMatch(/if \(!auth\.ok\) return \{ ok: false, res: auth\.res \}/);
  });

  it("derives the organization from the CREDENTIAL, never from the request", () => {
    // The whole point: a tenant a caller can name is a tenant a caller can
    // change. The lookup keys on the authenticated key's userId.
    expect(src).toContain("owner_user_id=eq.");
    expect(src).toContain("auth.record.userId");
    // No request-supplied tenant anywhere in the resolver.
    const fnStart = src.indexOf("export async function requireTenant");
    const body = src.slice(fnStart, src.indexOf("// ── Responses"));
    expect(body).not.toMatch(/body\.organizationId|params\.organizationId|searchParams/);
  });

  it("refuses an inactive organization and an environment mismatch", () => {
    expect(src).toContain("organization_inactive");
    expect(src).toContain("environment_mismatch");
  });

  it("refuses when the control plane has no durable backend", () => {
    // Deciding against a store that does not exist cannot be revoked or audited.
    expect(src).toContain("controlPlaneDurable()");
    expect(src).toContain("control_plane_unavailable");
  });

  it("answers 404 for another tenant's resource, identical to a missing one", () => {
    // Distinguishing "exists but not yours" from "no such thing" turns every id
    // into an existence oracle and completes half a BOLA attack for free.
    expect(src).toMatch(/export function notFound/);
    expect(src).toMatch(/problem\(404, "not_found"/);
    expect(src).not.toMatch(/problem\(403, "forbidden"/);
  });
});

describe("requireHumanTenant is a session check that an API key cannot pass", () => {
  // Admitted by the route-manifest validator for AUTHENTICATED_USER on the same
  // terms as requireTenant: only because these tests pin what it does.
  const fnStart = src.indexOf("export async function requireHumanTenant");
  const body = src.slice(fnStart, src.indexOf("// ── Responses"));

  it("exists", () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it("calls requireUser first and returns on failure", () => {
    const authAt = body.indexOf("requireUser(req)");
    const orgAt = body.indexOf("organizationOwnedBy(");
    expect(authAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(orgAt);
    expect(body).toMatch(/if \(!auth\.ok\) return \{ ok: false, res: auth\.res \}/);
  });

  it("never accepts an API key", () => {
    expect(body).not.toContain("requireApiKey");
  });

  it("derives the organization from the signed-in account, never from the request", () => {
    expect(body).toContain("organizationOwnedBy(auth.account.user.id)");
    expect(body).not.toMatch(/body\.organizationId|params\.organizationId|searchParams/);
  });
});

describe("the approval routes are human-only", () => {
  const API = join(__dirname, "..", "..", "..", "app", "api", "control-plane", "approvals");
  for (const file of ["route.ts", "[id]/route.ts"]) {
    const route = readFileSync(join(API, file), "utf8");
    it(`${file} resolves a human tenant and never an API key`, () => {
      expect(route).toContain("requireHumanTenant(req)");
      expect(route).not.toContain("requireApiKey");
      expect(route).not.toContain("requireTenant(");
    });
    it(`${file} has a per-route rate limit`, () => {
      expect(route).toMatch(/rateLimitOr429\(req, "cp\.approvals\./);
    });
  }

  it("deciding requires a fresh step-up and claims it atomically first", () => {
    const route = readFileSync(join(API, "[id]", "route.ts"), "utf8");
    const claimAt = route.indexOf("claimStepUp(");
    const decideAt = route.indexOf("decideApproval(");
    expect(claimAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(decideAt);
    // check-then-delete let concurrent requests share one step-up
    expect(route).not.toContain("consumeStepUp(");
  });
});

describe("every /api/v1 control-plane route goes through the wrapper", () => {
  const ROUTES = [
    ["mandates/route.ts", "agents:manage"],
    ["mandates/[id]/route.ts", "agents:read"],
    ["mandates/[id]/revoke/route.ts", "agents:manage"],
    ["payments/authorize/route.ts", "payments:create"],
    ["payments/execute/route.ts", "payments:create"],
    ["payments/[id]/route.ts", "payments:read"],
    ["evidence/[id]/route.ts", "ledger:read"],
  ] as const;

  const API = join(LIB, "..", "..", "app", "api", "v1");

  for (const [file, scope] of ROUTES) {
    it(`${file} requires a tenant with scope ${scope}`, () => {
      const route = readFileSync(join(API, file), "utf8");
      expect(route).toContain("requireTenant(req");
      expect(route).toContain(`"${scope}"`);
      // And returns immediately on failure rather than continuing.
      expect(route).toMatch(/if \(!tenant\.ok\) return tenant\.res;/);
    });

    it(`${file} never reads a tenant id from the request`, () => {
      const route = readFileSync(join(API, file), "utf8");
      expect(route).not.toMatch(/body\.organizationId/);
      expect(route).not.toMatch(/params\.organizationId/);
    });

    it(`${file} has a per-route rate limit`, () => {
      const route = readFileSync(join(API, file), "utf8");
      expect(route).toContain("rateLimitOr429");
    });
  }

  it("every mutating v1 route validates its body and is idempotent", () => {
    const MUTATING = [
      "mandates/route.ts",
      "mandates/[id]/revoke/route.ts",
      "payments/authorize/route.ts",
      "payments/execute/route.ts",
    ];
    for (const file of MUTATING) {
      const route = readFileSync(join(API, file), "utf8");
      expect(route, `${file} must validate its body`).toContain("validateBody(req");
      if (file !== "mandates/[id]/revoke/route.ts") {
        // Revoke is idempotent by construction (revoking a revoked mandate is a
        // success), so it does not need the key; the others create records.
        expect(route, `${file} must be idempotent`).toContain("withIdempotency");
      }
    }
  });

  it("amounts are accepted as decimal-digit STRINGS, never as JSON numbers", () => {
    // A JSON number is a double: 9007199254740993 does not survive the round
    // trip, and an 18-decimal atomic amount is far past that.
    for (const file of ["mandates/route.ts", "payments/authorize/route.ts"]) {
      const route = readFileSync(join(API, file), "utf8");
      expect(route).toMatch(/z\.string\(\)\.regex\(\/\^\[0-9\]\+\$\//);
      expect(route).not.toMatch(/amount:\s*z\.number/);
    }
  });
});
