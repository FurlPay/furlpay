import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeRouteFile,
  checkRoute,
  computeCounts,
  formatReport,
  exportsReadHandler,
  exportsOnlyMutating,
  RULES,
  type RouteFacts,
  type RouteRule,
} from "@/lib/security/routeManifestValidator";

// ---------------------------------------------------------------------------
// Tests for the checker itself.
//
// The manifest suite proves the CURRENT routes are classified correctly. It
// cannot prove the checker would notice if they stopped being — a validator
// that silently matches nothing also reports a clean build. These tests feed it
// known-bad code and require it to complain, including the exact scenario that
// motivated the work: someone deletes requireOpsAdmin() from a privileged route.
// ---------------------------------------------------------------------------

let dir: string;
const fixture = (name: string, source: string): string => {
  const p = join(dir, name);
  writeFileSync(p, source, "utf8");
  return p;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "route-validator-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const facts = (file: string, route = "test/route"): RouteFacts => {
  const { calls, methods, handlerless } = analyzeRouteFile(file);
  return { route, file, calls, methods, handlerless };
};

describe("AST analysis", () => {
  it("records a function that is CALLED", () => {
    const f = fixture(
      "called.ts",
      `import { requireUser } from "@/lib/authz";
       export async function GET(req: Request) {
         const auth = await requireUser(req);
         return Response.json({ ok: auth.ok });
       }`
    );
    expect(analyzeRouteFile(f).calls.has("requireUser")).toBe(true);
  });

  it("does NOT record a function that is merely IMPORTED", () => {
    // The whole point. An unused import protects nothing, and importing a guard
    // without invoking it is exactly the bug worth catching.
    const f = fixture(
      "imported-only.ts",
      `import { requireUser } from "@/lib/authz";
       export async function GET() {
         return Response.json({ ok: true });
       }`
    );
    expect(analyzeRouteFile(f).calls.has("requireUser")).toBe(false);
  });

  it("is not fooled by the guard name in a comment or a string", () => {
    // A regex-based checker passes this file. That is why this is an AST.
    const f = fixture(
      "decoy.ts",
      `// TODO: call requireUser(req) here before shipping
       const note = "requireUser(req)";
       export async function GET() { return Response.json({ note }); }`
    );
    const { calls } = analyzeRouteFile(f);
    expect(calls.has("requireUser")).toBe(false);
  });

  it("sees a guard invoked through a namespace or object", () => {
    const f = fixture(
      "namespaced.ts",
      `import * as guards from "@/lib/authz";
       export async function POST(req: Request) {
         const auth = await guards.requireUser(req);
         return Response.json({ ok: auth.ok });
       }`
    );
    expect(analyzeRouteFile(f).calls.has("requireUser")).toBe(true);
  });

  it("detects handlers declared as functions and as consts", () => {
    const fn = fixture("as-fn.ts", `export async function GET() { return Response.json({}); }`);
    const konst = fixture("as-const.ts", `export const POST = async () => Response.json({});`);
    expect(analyzeRouteFile(fn).methods.has("GET")).toBe(true);
    expect(analyzeRouteFile(konst).methods.has("POST")).toBe(true);
  });

  it("flags a module with no analysable handler rather than passing it vacuously", () => {
    const f = fixture("reexport.ts", `export { GET } from "./elsewhere";`);
    expect(analyzeRouteFile(f).handlerless).toBe(true);
  });

  it("ignores a non-exported function that happens to be named GET", () => {
    const f = fixture("private-get.ts", `function GET() {} export const POST = async () => Response.json({});`);
    const { methods } = analyzeRouteFile(f);
    expect(methods.has("GET")).toBe(false);
    expect(methods.has("POST")).toBe(true);
  });
});

describe("rule evaluation", () => {
  it("THE MOTIVATING CASE: removing requireOpsAdmin() from an ADMIN_ONLY route fails", () => {
    const guarded = fixture(
      "ops-guarded.ts",
      `import { requireOpsAdmin } from "@/lib/ops/respond";
       export async function POST(req: Request) {
         const auth = await requireOpsAdmin(req);
         if (!auth.ok) return auth.res;
         return Response.json({ paused: true });
       }`
    );
    expect(checkRoute(facts(guarded, "ops/controls"), "ADMIN_ONLY")).toEqual([]);

    // Now someone deletes the guard. Before this checker existed, CI stayed green.
    const unguarded = fixture(
      "ops-unguarded.ts",
      `export async function POST() { return Response.json({ paused: true }); }`
    );
    const violations = checkRoute(facts(unguarded, "ops/controls"), "ADMIN_ONLY");
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("admin-routes-check-a-role");
    expect(violations[0].severity).toBe("error");
  });

  it("accepts any of the guards that legitimately establish a principal", () => {
    for (const guard of ["requireUser", "requireRole", "requireOpsAdmin"]) {
      const f = fixture(
        `guard-${guard}.ts`,
        `export async function GET(req: Request) { await ${guard}(req); return Response.json({}); }`
      );
      expect(checkRoute(facts(f), "AUTHENTICATED_USER"), guard).toEqual([]);
    }
  });

  it("rejects authentication done by hand instead of through the shared guard", () => {
    // verifySession() alone skips the revocation denylist, MCP scope checks and
    // the deleted-account tombstone that requireUser() applies.
    const f = fixture(
      "handrolled.ts",
      `import { verifySession } from "@/lib/session";
       export async function POST(req: Request) {
         const claims = await verifySession(req.headers.get("cookie"));
         return Response.json({ sub: claims?.sub });
       }`
    );
    const violations = checkRoute(facts(f), "AUTHENTICATED_USER");
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("authenticated-routes-resolve-a-principal");
  });

  it("requires a rate limit on a public READER (no middleware backstop exists)", () => {
    const f = fixture("public-get.ts", `export async function GET() { return Response.json({}); }`);
    const violations = checkRoute(facts(f), "PUBLIC_INTENTIONAL");
    expect(violations.map((v) => v.ruleId)).toEqual(["public-readers-are-rate-limited"]);
    expect(violations[0].severity).toBe("error");
  });

  it("treats a public MUTATOR as debt, since the middleware baseline covers it", () => {
    const f = fixture("public-post.ts", `export async function POST() { return Response.json({}); }`);
    const violations = checkRoute(facts(f), "PUBLIC_INTENTIONAL");
    expect(violations.map((v) => v.ruleId)).toEqual(["public-mutators-have-a-per-route-budget"]);
    expect(violations[0].severity).toBe("debt");
  });

  it("passes a public reader that rate-limits itself", () => {
    const f = fixture(
      "public-limited.ts",
      `import { rateLimitOr429 } from "@/lib/rateLimit";
       export async function GET(req: Request) {
         const limited = await rateLimitOr429(req, "b", { limit: 60, windowMs: 60000 });
         if (limited) return limited;
         return Response.json({});
       }`
    );
    expect(checkRoute(facts(f), "PUBLIC_INTENTIONAL")).toEqual([]);
  });

  it("applies no rules to classifications a rule does not scope", () => {
    const f = fixture("webhook.ts", `export async function POST() { return Response.json({}); }`);
    expect(checkRoute(facts(f), "WEBHOOK_VERIFIED")).toEqual([]);
  });

  it("supports a caller-supplied rule set, so new invariants are data not code", () => {
    const idempotency: RouteRule = {
      id: "money-routes-are-idempotent",
      appliesTo: ["AUTHENTICATED_USER"],
      requiresAnyCall: ["withIdempotencyKey"],
      severity: "error",
      reason: "A retried transfer must not move funds twice.",
      fix: "wrap the handler in withIdempotencyKey()",
    };
    const f = fixture(
      "money.ts",
      `export async function POST(req: Request) { await requireUser(req); return Response.json({}); }`
    );
    const violations = checkRoute(facts(f), "AUTHENTICATED_USER", [idempotency]);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("money-routes-are-idempotent");
  });
});

describe("scope predicates", () => {
  const withMethods = (...methods: string[]): RouteFacts => ({
    route: "r",
    file: "f",
    calls: new Set(),
    methods: new Set(methods),
    handlerless: methods.length === 0,
  });

  it("classifies readers and mutators correctly", () => {
    expect(exportsReadHandler(withMethods("GET"))).toBe(true);
    expect(exportsReadHandler(withMethods("HEAD"))).toBe(true);
    expect(exportsReadHandler(withMethods("POST"))).toBe(false);
    expect(exportsOnlyMutating(withMethods("POST", "DELETE"))).toBe(true);
    // A file exposing both is a reader too — the GET still needs its own limit.
    expect(exportsOnlyMutating(withMethods("GET", "POST"))).toBe(false);
    expect(exportsReadHandler(withMethods("GET", "POST"))).toBe(true);
  });
});

describe("count recomputation and reporting", () => {
  it("recomputes totals from the classifications rather than trusting them", () => {
    const { total, counts } = computeCounts({
      a: "PUBLIC_INTENTIONAL",
      b: "PUBLIC_INTENTIONAL",
      c: "ADMIN_ONLY",
    });
    expect(total).toBe(3);
    expect(counts).toEqual({ ADMIN_ONLY: 1, PUBLIC_INTENTIONAL: 2 });
  });

  it("names the route, the rule and the fix in its output", () => {
    const f = fixture("report.ts", `export async function GET() { return Response.json({}); }`);
    const report = formatReport(checkRoute(facts(f, "markets/search"), "PUBLIC_INTENTIONAL"), 205);
    expect(report).toContain("markets/search");
    expect(report).toContain("public-readers-are-rate-limited");
    expect(report).toContain("rateLimitOr429");
    expect(report).toContain("FAIL");
  });

  it("reports a pass when nothing is wrong", () => {
    expect(formatReport([], 205)).toContain("PASS");
  });
});

describe("the shipped rule set", () => {
  it("every rule carries a reason and an actionable fix", () => {
    for (const rule of RULES) {
      expect(rule.reason.length, rule.id).toBeGreaterThan(20);
      expect(rule.fix.length, rule.id).toBeGreaterThan(10);
      expect(rule.requiresAnyCall.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("has unique rule ids", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
