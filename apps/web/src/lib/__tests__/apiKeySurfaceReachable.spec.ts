import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// F-13: the API-key authenticated surface must actually be reachable.
//
// THE DEFECT. middleware.ts gates every `/api/*` path on `isPublicApi ||
// hasSession`, where `hasSession` means a verified SESSION JWT from a cookie or
// a bearer. An API key is not a session JWT, so an API-key caller was answered
// 401 by the middleware and NEVER REACHED the route — including
// `requireApiKey`, which is the only thing that checks the key's scope,
// revocation, expiry, environment and IP allowlist.
//
// It fails closed, so it is not an authorization hole. It is worse in a
// different way: every route classified API_KEY_AUTHENTICATED was unreachable,
// and the pre-existing `/api/v1/payments` says in its own comment that it "is
// the route that makes `payments:read` mean something". That check had never
// run. A permission enforced on a path nobody can take is the same label the
// route manifest exists to stop us shipping.
//
// THE FIX follows the two precedents already in the file: `/api/mcp` passes
// through because it self-authenticates with an OAuth bearer, and `/api/escrow`
// passes through when it carries an RFC 9421 signature. `/api/v1` passes through
// ONLY when a credential is presented, so an unauthenticated caller still gets
// the middleware's 401 and never reaches a route.
// ---------------------------------------------------------------------------

const WEB = join(__dirname, "..", "..", "..");
const middleware = readFileSync(join(WEB, "src", "middleware.ts"), "utf8");
const manifest = JSON.parse(
  readFileSync(join(WEB, "security", "route-manifest.json"), "utf8")
) as { routes: Record<string, string> };

describe("every API_KEY_AUTHENTICATED route can be reached by an API key", () => {
  const keyRoutes = Object.entries(manifest.routes)
    .filter(([, cls]) => cls === "API_KEY_AUTHENTICATED")
    .map(([path]) => path);

  it("there is at least one such route to protect", () => {
    expect(keyRoutes.length).toBeGreaterThan(0);
  });

  it("the middleware admits a credential-bearing request to /api/v1", () => {
    // Without this the route's own requireApiKey never runs, and the scope,
    // revocation and expiry checks it performs are all unreachable.
    expect(middleware).toMatch(/pathname\.startsWith\("\/api\/v1"\)/);
    expect(middleware).toMatch(/authorization/i);
  });

  it("the pass-through requires a credential and is NOT unconditional", () => {
    // `/api/v1` must not join PUBLIC_API_PREFIXES: that would admit callers with
    // no credential at all, and the 401 an anonymous caller currently receives
    // is correct and worth keeping.
    const publicBlock = middleware.slice(
      middleware.indexOf("const PUBLIC_API_PREFIXES"),
      middleware.indexOf("];", middleware.indexOf("const PUBLIC_API_PREFIXES"))
    );
    expect(publicBlock).not.toContain('"/api/v1"');

    // And the pass-through is conditional on a header being present.
    const gate = middleware.slice(
      middleware.indexOf('pathname.startsWith("/api/v1")'),
      middleware.indexOf('pathname.startsWith("/api/v1")') + 400
    );
    expect(gate).toMatch(/req\.headers\.get\("authorization"\)/);
  });

  it("every API_KEY_AUTHENTICATED route lives under a prefix the middleware admits", () => {
    // A route classified for key auth but sitting under a prefix the middleware
    // blocks is a route nobody can call. Catch that here rather than in support.
    for (const route of keyRoutes) {
      const reachable =
        route.startsWith("v1/") ||
        route.startsWith("mcp") ||
        route.startsWith("oauth") ||
        route.startsWith("webhooks");
      expect(reachable, `${route} is classified API_KEY_AUTHENTICATED but sits under a blocked prefix`).toBe(
        true
      );
    }
  });
});

describe("the v1 routes exist on disk exactly as the manifest claims", () => {
  const API = join(WEB, "src", "app", "api");

  function routeExists(route: string): boolean {
    try {
      return statSync(join(API, ...route.split("/"), "route.ts")).isFile();
    } catch {
      return false;
    }
  }

  it("every manifest entry under v1/ has a file", () => {
    for (const [route, cls] of Object.entries(manifest.routes)) {
      if (!route.startsWith("v1/")) continue;
      expect(routeExists(route), `${route} is in the manifest (${cls}) but has no route.ts`).toBe(true);
    }
  });

  it("every v1 route file is in the manifest", () => {
    // The reverse direction: an unclassified route is one the security rules
    // never evaluate.
    const found: string[] = [];
    (function walk(dir: string, prefix: string) {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, prefix ? `${prefix}/${entry}` : entry);
        else if (entry === "route.ts" && prefix) found.push(`v1/${prefix}`);
      }
    })(join(API, "v1"), "");
    // The bare v1/payments collection route has no sub-path.
    if (statSync(join(API, "v1", "payments", "route.ts")).isFile()) found.push("v1/payments");

    for (const route of found) {
      expect(manifest.routes[route], `${route} exists on disk but is unclassified`).toBeTruthy();
    }
  });
});
