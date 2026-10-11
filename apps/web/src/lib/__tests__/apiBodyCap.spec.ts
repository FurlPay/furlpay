import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ---------------------------------------------------------------------------
// The API body-size backstop.
//
// THE DEFECT THIS LOCKS DOWN. lib/validate.ts caps request bodies at 100KB and
// says why — "JSON.parse on a huge body is the cheapest way to burn a function"
// — but the cap only applied to handlers that routed through validateBody(). An
// audit sweep found 74 route files calling `await req.json()` directly, around
// thirty of them classified PUBLIC_INTENTIONAL, including the x402 facilitator's
// /verify and /settle. Those are unauthenticated by protocol design and they
// move money, so the one surface an attacker reaches without credentials was the
// one surface with no bound on how much work a single request could cause.
//
// The fix is a content-length guard in middleware.ts, which is the only place
// every /api/* request must pass. These tests assert the control exists THERE
// rather than testing a helper in isolation: a per-route cap is a cap somebody
// forgets on route 75.
// ---------------------------------------------------------------------------

const WEB_ROOT = join(__dirname, "..", "..", "..");
const MIDDLEWARE = join(WEB_ROOT, "src", "middleware.ts");
const API_DIR = join(WEB_ROOT, "src", "app", "api");

function middlewareSource(): string {
  return readFileSync(MIDDLEWARE, "utf8");
}

function routeFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === "route.ts") out.push(p);
    }
  })(API_DIR);
  return out;
}

describe("API request bodies are bounded before routing", () => {
  it("middleware declares a body ceiling equal to validateBody's", () => {
    const mw = middlewareSource();
    expect(mw).toMatch(/MAX_API_BODY_BYTES\s*=\s*100\s*\*\s*1024/);

    // The two limits must agree. If they drift, a request can be accepted by
    // one layer and rejected by the other, which turns a size guard into a
    // confusing intermittent failure.
    const validate = readFileSync(join(WEB_ROOT, "src", "lib", "validate.ts"), "utf8");
    expect(validate).toMatch(/MAX_BODY_BYTES\s*=\s*100\s*\*\s*1024/);
  });

  it("middleware rejects an oversized body with 413 on every mutating API method", () => {
    const mw = middlewareSource();
    // The guard reads content-length, compares against the ceiling, and answers
    // 413 — not 400, not 500. A caller must be able to tell "too big" from
    // "malformed".
    expect(mw).toMatch(/content-length/i);
    expect(mw).toMatch(/MAX_API_BODY_BYTES/);
    expect(mw).toMatch(/payload_too_large/);
    expect(mw).toMatch(/status:\s*413/);
  });

  it("the guard is NOT scoped to a prefix allowlist, so no route can opt out", () => {
    const mw = middlewareSource();
    // The guard's own region: from its banner comment to the size comparison.
    // Bounded tightly on purpose — the rate-limit block that follows legitimately
    // names BASELINE_EXEMPT_PREFIXES, and including it would make this assertion
    // test the wrong code.
    const start = mw.indexOf("Body-size backstop");
    const end = mw.indexOf("declared > cap");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const guard = mw.slice(start, end);

    // BASELINE_EXEMPT_PREFIXES exempts webhooks from the rate limit. The body
    // cap must not inherit that exemption: a webhook flood with huge bodies is
    // precisely the case where the cap matters most.
    expect(guard).not.toContain("BASELINE_EXEMPT_PREFIXES");
    expect(guard).not.toContain("PUBLIC_API_PREFIXES");
    // And the condition itself gates on nothing but "is this a mutating API call".
    expect(guard).toMatch(/isApi\s*&&\s*MUTATING_METHODS\.has\(req\.method\)/);
  });

  it("allows a larger cap only for exact paths listed and reviewed in LARGE_BODY_ROUTES", () => {
    const mw = middlewareSource();
    // The one sanctioned way to raise the cap: an exact path, a number, and a
    // comment saying why. Not a prefix, and never removing the check.
    const start = mw.indexOf("const LARGE_BODY_ROUTES");
    expect(start).toBeGreaterThan(-1);
    const table = mw.slice(start, mw.indexOf("};", start));
    const entries = [...table.matchAll(/^\s*"([^"]+)":\s*([\d_]+),/gm)].map((m) => [m[1], Number(m[2].replace(/_/g, ""))]);
    // Reviewed list. Adding a route here is a security decision; update this test with it.
    expect(entries).toEqual([["/api/webhooks/allium", 1_000_000]]);
    // Looked up by exact key, not by prefix.
    expect(mw).toMatch(/Object\.hasOwn\(LARGE_BODY_ROUTES,\s*pathname\)/);
  });

  it("the guard runs BEFORE the rate limiter, so an oversized body is cheap to refuse", () => {
    const mw = middlewareSource();
    const capAt = mw.indexOf("declared > cap");
    const rateAt = mw.indexOf("api-baseline:");
    expect(capAt).toBeGreaterThan(-1);
    expect(rateAt).toBeGreaterThan(-1);
    // Ordering is the point: parsing a 50MB body to discover the caller is
    // rate-limited has already cost the memory.
    expect(capAt).toBeLessThan(rateAt);
  });

  it("the unauthenticated, money-moving facilitator routes are covered by the guard", () => {
    // These two are the reason the finding was filed: PUBLIC_INTENTIONAL by
    // protocol design, they sponsor gas, and neither uses validateBody().
    const manifest = JSON.parse(
      readFileSync(join(WEB_ROOT, "security", "route-manifest.json"), "utf8")
    ) as { routes: Record<string, string> };

    for (const route of ["x402/facilitator/verify", "x402/facilitator/settle"]) {
      expect(manifest.routes[route]).toBe("PUBLIC_INTENTIONAL");
    }

    // The guard applies to every /api/* path, so being public is not an escape.
    const mw = middlewareSource();
    expect(mw).toMatch(/isApi\s*&&\s*MUTATING_METHODS\.has\(req\.method\)/);
  });

  it("no route handler parses a body with an unbounded req.json() / req.text()", () => {
    // This was a measurement: 59 route files called `await req.json()`, which
    // buffers the whole body before anything can check its size. The
    // middleware guard only sees Content-Length, so a chunked upload that
    // declares none went straight through to an unbounded read (audit F-10,
    // F-38). Every one now reads through readJsonBody/validateBody, which stop
    // the stream at the cap. Keep it at zero.
    // Code only: comments that explain the old bug mention req.json() by name.
    const code = (f: string) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const unbounded = routeFiles()
      .filter((f) => /\breq(\.clone\(\))?\.(json|text|arrayBuffer|formData)\(\)/.test(code(f)))
      .map((f) => relative(API_DIR, f).split(sep).join("/"));
    expect(unbounded).toEqual([]);
  });
});

describe("the bounded readers stop a body that declares no length", () => {
  const chunked = (total: number) => {
    let sent = 0;
    const chunk = new TextEncoder().encode(" ".repeat(16 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= total) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const req = new Request("https://furlpay.com/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    return { req, sent: () => sent };
  };

  it("readJsonBody rejects past the cap and stops reading", async () => {
    const { readJsonBody, BodyTooLarge } = await import("@/lib/validate");
    const { req, sent } = chunked(5_000_000);
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(sent()).toBeLessThan(100 * 1024 + 3 * 16 * 1024);
  });

  it("validateBody answers 413 without buffering the whole stream", async () => {
    const { validateBody } = await import("@/lib/validate");
    const { z } = await import("zod");
    const { req, sent } = chunked(5_000_000);
    const res = await validateBody(req, z.object({}));
    expect((res as Response).status).toBe(413);
    expect(sent()).toBeLessThan(100 * 1024 + 3 * 16 * 1024);
  });

  it("readJsonBody keeps req.json() semantics for valid, invalid and empty bodies", async () => {
    const { readJsonBody } = await import("@/lib/validate");
    const mk = (body: string) => new Request("https://furlpay.com/api/x", { method: "POST", body });
    await expect(readJsonBody(mk('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonBody(mk("{nope"))).rejects.toBeInstanceOf(SyntaxError);
    await expect(readJsonBody(mk(""))).rejects.toBeInstanceOf(SyntaxError);
  });

  it("a lying Content-Length smaller than the body does not raise the cap", async () => {
    const { readJsonBody, BodyTooLarge } = await import("@/lib/validate");
    const big = JSON.stringify({ pad: "x".repeat(200 * 1024) });
    const req = new Request("https://furlpay.com/api/x", { method: "POST", body: big, headers: { "content-length": "10" } });
    await expect(readJsonBody(req)).rejects.toBeInstanceOf(BodyTooLarge);
  });
});
