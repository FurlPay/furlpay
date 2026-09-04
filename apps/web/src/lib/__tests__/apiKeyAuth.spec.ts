import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireApiKey, bearerToken, clientIp } from "../apiKeyAuth";
import { createApiKey, revokeApiKey, getApiKey } from "../apiKeys";

// ---------------------------------------------------------------------------
// The enforcement boundary.
//
// apiKeys.ts decides what a credential MAY do; this module is what actually
// stops a request. A scope that is checked nowhere is a label, so these tests
// assert the HTTP contract a caller meets:
//
//   401  your credential is wrong          → retrying with the same key is futile
//   403  your credential is right, and no  → retrying is futile for a different reason
//
// The split is not cosmetic. A client library that retries on 401 (refresh
// the token) and gives up on 403 (ask a human) behaves correctly only if the
// server draws the line in the right place.
// ---------------------------------------------------------------------------

const USER = "user_enforcement";

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

function request(headers: Record<string, string> = {}, url = "https://api.furlpay.com/v1/payments") {
  return new NextRequest(url, { headers });
}

async function keyWith(scopes: Parameters<typeof createApiKey>[0]["scopes"], over = {}) {
  return createApiKey({
    userId: USER,
    name: "Test key",
    prefix: "rk",
    environment: "live",
    scopes,
    ...over,
  });
}

describe("bearer parsing", () => {
  it("reads a well-formed Authorization header", () => {
    expect(bearerToken(request({ authorization: "Bearer rk_live_a_b" }))).toBe("rk_live_a_b");
    expect(bearerToken(request({ authorization: "bearer rk_live_a_b" }))).toBe("rk_live_a_b");
  });

  it("refuses anything that is not exactly one bearer token", () => {
    expect(bearerToken(request())).toBeNull();
    expect(bearerToken(request({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(request({ authorization: "Bearer" }))).toBeNull();
    // Two tokens is not a credential, it is an attempt to confuse the parser.
    expect(bearerToken(request({ authorization: "Bearer a b" }))).toBeNull();
  });
});

describe("client IP", () => {
  it("takes the first hop of x-forwarded-for", () => {
    // The list grows left-to-right; the original client is first. Reading the
    // last entry would give the proxy's own address and make every allowlist
    // match the wrong thing.
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.10, 70.41.3.18" }))).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip and then to nothing", () => {
    expect(clientIp(request({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(request())).toBeNull();
  });
});

describe("authentication failures answer 401", () => {
  it("rejects a request with no credential and advertises the scheme", async () => {
    const result = await requireApiKey(request(), { scope: "payments:read" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(401);
      expect(result.res.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
  });

  it("gives an identical body for an unknown key and a bad secret", async () => {
    const { record } = await keyWith(["payments:read"]);

    const unknown = await requireApiKey(
      request({ authorization: "Bearer rk_live_notarealkeyid000000_notarealsecret" }),
      { scope: "payments:read" }
    );
    const badSecret = await requireApiKey(
      request({ authorization: `Bearer rk_live_${record.keyId}_${"A".repeat(43)}` }),
      { scope: "payments:read" }
    );

    expect(unknown.ok).toBe(false);
    expect(badSecret.ok).toBe(false);
    if (!unknown.ok && !badSecret.ok) {
      expect(unknown.res.status).toBe(401);
      expect(badSecret.res.status).toBe(401);
      // IDENTICAL. A different message for "that id exists" would turn this
      // endpoint into an oracle for enumerating real key ids without ever
      // holding a secret.
      expect(await unknown.res.json()).toEqual(await badSecret.res.json());
    }
  });
});

describe("authorization failures answer 403", () => {
  it("accepts a key holding the required scope", async () => {
    const { secret } = await keyWith(["payments:read"]);
    const result = await requireApiKey(request({ authorization: `Bearer ${secret}` }), {
      scope: "payments:read",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a scope the key does not hold, and names it", async () => {
    const { secret } = await keyWith(["payments:read"]);
    const result = await requireApiKey(request({ authorization: `Bearer ${secret}` }), {
      scope: "transfers:create",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(403);
      const body = await result.res.json();
      expect(body.error).toBe("insufficient_scope");
      // The caller already proved it holds this key, so telling it which
      // permission is missing leaks nothing and saves a support ticket.
      expect(body.requiredScope).toBe("transfers:create");
    }
  });

  it("refuses a revoked key", async () => {
    const { record, secret } = await keyWith(["payments:read"]);
    await revokeApiKey(USER, record.keyId);
    const result = await requireApiKey(request({ authorization: `Bearer ${secret}` }), {
      scope: "payments:read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(403);
      expect((await result.res.json()).error).toBe("revoked");
    }
  });

  it("refuses a sandbox key on a live endpoint", async () => {
    const { secret } = await keyWith(["payments:read"], { environment: "test" });
    const result = await requireApiKey(request({ authorization: `Bearer ${secret}` }), {
      scope: "payments:read",
      environment: "live",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(403);
      expect((await result.res.json()).error).toBe("wrong_environment");
    }
  });

  it("enforces the IP allowlist against the forwarded client address", async () => {
    const { secret } = await keyWith(["payments:read"], { ipAllowlist: ["203.0.113.0/24"] });

    const inside = await requireApiKey(
      request({ authorization: `Bearer ${secret}`, "x-forwarded-for": "203.0.113.7" }),
      { scope: "payments:read" }
    );
    expect(inside.ok).toBe(true);

    const outside = await requireApiKey(
      request({ authorization: `Bearer ${secret}`, "x-forwarded-for": "198.51.100.7" }),
      { scope: "payments:read" }
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.res.status).toBe(403);

    // No discernible client address at all must not bypass a configured
    // allowlist.
    const noIp = await requireApiKey(request({ authorization: `Bearer ${secret}` }), {
      scope: "payments:read",
    });
    expect(noIp.ok).toBe(false);
  });
});

describe("usage telemetry", () => {
  it("records the route on a successful call without blocking it", async () => {
    const { record, secret } = await keyWith(["payments:read"]);
    const result = await requireApiKey(
      request({ authorization: `Bearer ${secret}`, "x-forwarded-for": "203.0.113.9" }),
      { scope: "payments:read" }
    );
    expect(result.ok).toBe(true);

    // The write is deliberately not awaited by the middleware, so give the
    // microtask queue a turn before reading it back.
    await new Promise((r) => setTimeout(r, 20));
    const stored = await getApiKey(record.keyId);
    expect(stored!.lastUsedRoute).toBe("/v1/payments");
    expect(stored!.lastUsedAt).not.toBeNull();
  });
});
