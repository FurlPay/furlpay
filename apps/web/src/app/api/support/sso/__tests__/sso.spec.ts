import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSameOrigin } from "@/lib/safeRedirect";

// ---------------------------------------------------------------------------
// The dormant Zendesk SSO handoff.
//
// This route has no test coverage from anywhere else, and TWO separate safety
// nets skip it for the same reason — it is a GET:
//
//   * the middleware baseline rate limit applies to MUTATING_METHODS only
//   * check-route-security.mjs audits only mutating handlers
//
// So "check-route-security clean" has never said anything about this file. It
// also 404s until configured and no UI links to it, which means a defect here
// surfaces on the first day someone switches the integration on, in production,
// with no local reproduction. That is precisely the situation that warrants
// tests asserting the invariants rather than the behaviour.
//
// Source-level assertions are the honest tool here: importing the handler would
// need a session, a KV layer and a Zendesk secret, and would still not prove the
// CSP interaction, which lives in next.config.js.
// ---------------------------------------------------------------------------

const ROUTE = readFileSync(join(__dirname, "..", "route.ts"), "utf8");
const CONFIG = readFileSync(
  join(__dirname, "..", "..", "..", "..", "..", "..", "next.config.js"),
  "utf8"
);

describe("dormancy", () => {
  it("404s unless BOTH the subdomain and the shared secret are set", () => {
    expect(ROUTE).toMatch(/if \(!subdomain \|\| !secret/);
    expect(ROUTE).toContain("status: 404");
  });

  it("validates the subdomain charset before using it in a URL", () => {
    // The subdomain is interpolated into both a form action and the CSP. An
    // unvalidated value would let a bad env var rewrite either.
    expect(ROUTE).toMatch(/\/\^\[a-z0-9-\]\+\$\/\.test\(subdomain\)/);
  });

  it("exposes only GET", () => {
    const handlers = [...ROUTE.matchAll(/export\s+async\s+function\s+([A-Z]+)/g)].map((m) => m[1]);
    expect(handlers).toEqual(["GET"]);
  });
});

describe("authentication", () => {
  it("requires a session and sends a signed-out visitor to log in and come back", () => {
    expect(ROUTE).toContain("requireUser(req)");
    expect(ROUTE).toMatch(/\/login\?next=/);
  });

  it("rate-limits, because neither the middleware nor the scanner covers a GET", () => {
    expect(ROUTE).toContain("rateLimitOr429");
    expect(ROUTE).toContain('"support.sso"');
  });
});

describe("the credential never reaches a URL or a cache", () => {
  it("sends the JWT as a form field, not a query parameter", () => {
    // A JWT in a query string lands in browser history, proxy logs and the
    // Referer header. It is a live credential for the support identity.
    expect(ROUTE).toMatch(/name="jwt" value="\$\{escapeAttr\(jwt\)\}"/);
    expect(ROUTE).not.toMatch(/jwt=\$\{/);
  });

  it("marks the page no-store", () => {
    expect(ROUTE).toContain('"Cache-Control": "no-store"');
  });

  it("escapes both values interpolated into HTML attributes", () => {
    expect(ROUTE).toContain("escapeAttr(jwt)");
    expect(ROUTE).toContain("escapeAttr(returnTo)");
  });

  it("signs server-side only — the shared secret can mint any user's session", () => {
    expect(ROUTE).toContain("process.env.ZENDESK_SHARED_SECRET");
    expect(ROUTE).not.toContain("NEXT_PUBLIC_ZENDESK");
  });
});

describe("return_to cannot leave the configured Zendesk host", () => {
  // The route resolves return_to through lib/safeRedirect against the Zendesk
  // origin; these exercise that same function, not a copy of it.
  const Z = "https://furlpay.zendesk.com";
  const guard = (raw: string) => resolveSameOrigin(raw, Z)?.href ?? "";

  it("the route uses the shared resolver, not a hand-rolled prefix check", () => {
    expect(ROUTE).toContain('import { resolveSameOrigin } from "@/lib/safeRedirect"');
    expect(ROUTE).toMatch(/resolveSameOrigin\(req\.nextUrl\.searchParams\.get\("return_to"\), zendeskOrigin\)/);
    expect(ROUTE).not.toMatch(/startsWith\("\/\/"\)/);
  });

  it.each([
    ["//evil.com", ""],
    ["///evil.com", ""],
    ["/\\evil.com", ""],
    ["/\t/evil.com", ""],
    ["/..//evil.com", ""],
    ["https://evil.com", ""],
    ["http://evil.com", ""],
    ["javascript:alert(1)", ""],
    ["data:text/html,<script>alert(1)</script>", ""],
    ["", ""],
  ])("drops %j", (raw, expected) => {
    expect(guard(raw)).toBe(expected);
  });

  it.each([
    "/hc/en-us",
    "/hc/en-us/requests/new",
    "/%2f%2fevil.com",
    "/redirect?url=https://evil.com",
  ])("keeps %s on the configured host", (raw) => {
    const out = guard(raw);
    expect(out).not.toBe("");
    expect(new URL(out).host).toBe("furlpay.zendesk.com");
  });
});

describe("the CSP allows the handoff only when it is configured", () => {
  it("makes form-action conditional on ZENDESK_SUBDOMAIN", () => {
    // With a bare `form-action 'self'` the browser blocks the cross-origin POST
    // this route depends on: the page renders, submit() runs, nothing happens.
    expect(CONFIG).toMatch(/form-action 'self'\$\{zendeskFormAction\}/);
    expect(CONFIG).toContain("process.env.ZENDESK_SUBDOMAIN");
  });

  it("validates the subdomain before putting it in a security header", () => {
    expect(CONFIG).toMatch(/\/\^\[a-z0-9-\]\+\$\/\.test\(zendeskSubdomain\)/);
  });

  it("adds no wildcard host", () => {
    // `https://*.zendesk.com` would widen the live policy permanently for a
    // dormant feature. Only the configured subdomain is ever named.
    expect(CONFIG).not.toContain("*.zendesk.com");
  });
});
