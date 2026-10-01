import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { checkOrigin } from "../originVerify";

// ---------------------------------------------------------------------------
// Origin verification (lib/originVerify.ts) through the REAL middleware.
//
// Behind CloudFront every request must carry X-Origin-Verify; a request that
// reaches the ALB/task without it did not come through our distribution (or its
// WAF) and is answered 404 before any session, KV or route work. Environments
// that declare nothing — local dev, Vercel — are unaffected.
// ---------------------------------------------------------------------------

const SECRET = "o".repeat(40) + "-origin-verify-test-secret";

function req(path: string, opts: { method?: string; header?: string | null } = {}) {
  const headers = new Headers({ host: "api-staging.furlpay.com" });
  if (opts.header != null) headers.set("x-origin-verify", opts.header);
  return new NextRequest(`https://api-staging.furlpay.com${path}`, { method: opts.method ?? "GET", headers });
}

function behindCloudFront() {
  process.env.ORIGIN_VERIFY_REQUIRED = "true";
  process.env.ORIGIN_VERIFY_SECRET = SECRET;
}

const passedThrough = (res: Response) => res.status !== 404 && res.status !== 503;

afterEach(() => {
  delete process.env.ORIGIN_VERIFY_REQUIRED;
  delete process.env.ORIGIN_VERIFY_SECRET;
});

describe("origin verification behind CloudFront", () => {
  it("1. a request carrying the CloudFront secret is served", async () => {
    behindCloudFront();
    const res = await middleware(req("/api/markets", { header: SECRET }));
    expect(passedThrough(res)).toBe(true);
  });

  it("2. a request with no header is refused with 404", async () => {
    behindCloudFront();
    const res = await middleware(req("/api/markets"));
    expect(res.status).toBe(404);
  });

  it("3. a wrong header is refused — same length and different length", async () => {
    behindCloudFront();
    const sameLength = SECRET.slice(0, -1) + (SECRET.endsWith("x") ? "y" : "x");
    expect((await middleware(req("/api/markets", { header: sameLength }))).status).toBe(404);
    expect((await middleware(req("/api/markets", { header: "guess" }))).status).toBe(404);
    expect((await middleware(req("/api/markets", { header: "" }))).status).toBe(404);
  });

  it("4. a direct-to-origin request is refused before auth, for pages and mutating API calls alike", async () => {
    behindCloudFront();
    // Without the check a page would redirect to /login and a POST would reach
    // the rate limiter / route — both prove the origin is reachable.
    expect((await middleware(req("/dashboard"))).status).toBe(404);
    expect((await middleware(req("/api/transfers", { method: "POST" }))).status).toBe(404);
  });

  it("the liveness probe is reachable without the header (ALB health checks cannot send it), GET/HEAD only", async () => {
    behindCloudFront();
    expect(checkOrigin("/api/health", "GET", null)).toBe("allow");
    expect(checkOrigin("/api/health", "HEAD", null)).toBe("allow");
    expect(checkOrigin("/api/health", "POST", null)).toBe("reject");
    expect(checkOrigin("/api/healthz", "GET", null)).toBe("reject");
  });

  it("FAILS CLOSED when declared required but the secret is missing or weak — health included, so ECS rolls back", async () => {
    process.env.ORIGIN_VERIFY_REQUIRED = "true";
    expect((await middleware(req("/api/markets", { header: "anything" }))).status).toBe(503);
    expect(checkOrigin("/api/health", "GET", null)).toBe("misconfigured");
    process.env.ORIGIN_VERIFY_SECRET = "short";
    expect((await middleware(req("/api/markets", { header: "short" }))).status).toBe(503);
  });
});

describe("origin verification — hostile and edge-case headers", () => {
  it("6. malformed values are refused: padded, case-changed, non-ASCII", () => {
    behindCloudFront();
    for (const bad of [` ${SECRET}`, `${SECRET} `, SECRET.toUpperCase(), SECRET.slice(0, -1) + "é"]) {
      expect(checkOrigin("/api/markets", "GET", bad)).toBe("reject");
    }
  });

  it("7. a repeated header (joined as 'a, a') and an oversized header are refused", async () => {
    behindCloudFront();
    const headers = new Headers({ host: "api-staging.furlpay.com" });
    headers.append("x-origin-verify", SECRET);
    headers.append("x-origin-verify", SECRET);
    const res = await middleware(new NextRequest("https://api-staging.furlpay.com/api/markets", { headers }));
    expect(res.status).toBe(404);
    expect(checkOrigin("/api/markets", "GET", "x".repeat(16_384))).toBe("reject");
  });

  it("8. API requests: refused without the header, routed normally with it", async () => {
    behindCloudFront();
    expect((await middleware(req("/api/account"))).status).toBe(404);
    expect((await middleware(req("/api/account", { header: SECRET }))).status).toBe(401); // the auth gate still applies
  });

  it("9. HEAD is not a bypass (except the liveness probe)", async () => {
    behindCloudFront();
    expect((await middleware(req("/api/markets", { method: "HEAD" }))).status).toBe(404);
    expect(passedThrough(await middleware(req("/api/markets", { method: "HEAD", header: SECRET })))).toBe(true);
  });

  it("10. OPTIONS (CORS preflight) is not a bypass", async () => {
    behindCloudFront();
    expect((await middleware(req("/api/markets", { method: "OPTIONS" }))).status).toBe(404);
    expect(passedThrough(await middleware(req("/api/markets", { method: "OPTIONS", header: SECRET })))).toBe(true);
  });

  it("the refusal never reveals the secret or whether a guess was close", async () => {
    behindCloudFront();
    const missing = await middleware(req("/api/markets"));
    const wrong = await middleware(req("/api/markets", { header: SECRET.slice(0, -1) + "x" }));
    expect([missing.status, await missing.text()]).toEqual([wrong.status, await wrong.text()]);
    expect(await (await middleware(req("/api/markets", { header: "guess" }))).text()).not.toContain(SECRET);
  });
});

describe("protected routes stay protected WITH a valid origin header", () => {
  it("pages still redirect to /login, APIs still 401, /api/health needs no session", async () => {
    behindCloudFront();
    const page = await middleware(req("/dashboard", { header: SECRET }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    expect((await middleware(req("/api/transfers", { method: "POST", header: SECRET }))).status).toBe(401);
    // Liveness probe: no header (ALB-direct), no session, not version-gated, not CSRF-checked.
    expect(passedThrough(await middleware(req("/api/health")))).toBe(true);
  });
});

describe("5. normal local development / Vercel behaviour", () => {
  it("with nothing declared, requests pass exactly as before", async () => {
    const res = await middleware(req("/api/markets"));
    expect(passedThrough(res)).toBe(true);
    // A protected page still redirects to /login — the origin check added nothing here.
    const page = await middleware(req("/dashboard"));
    expect(page.status).toBe(307);
  });
});
