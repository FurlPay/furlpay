import { describe, expect, it } from "vitest";
import {
  issueAccessToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
} from "@/lib/mcp/oauth";
import { mcpDenialFor, requiredScopeFor } from "@/lib/mcp/routeScopes";
import { revokeSession, signSession, verifySession } from "@/lib/session";
import { kvGet } from "@/lib/kv";
import type { McpClaims } from "@/lib/mcp/oauth";

// ---------------------------------------------------------------------------
// Refresh token rotation. The properties that matter:
//   single-use, family-revoked-on-reuse, client-bound, revocable.
// ---------------------------------------------------------------------------

const mkRefresh = () =>
  issueRefreshToken({ userId: "user_1", clientId: "client_a", scopes: ["wallets:read"] });

describe("refresh token rotation", () => {
  it("rotates: old token dies, new token works", async () => {
    const rt1 = await mkRefresh();
    const r1 = await rotateRefreshToken({ token: rt1, clientId: "client_a" });
    expect(r1).toMatchObject({ ok: true, userId: "user_1", scopes: ["wallets:read"] });
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.refreshToken).not.toBe(rt1);

    const replay = await rotateRefreshToken({ token: rt1, clientId: "client_a" });
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("REVOKES THE WHOLE FAMILY when a rotated token is replayed (theft signal)", async () => {
    const rt1 = await mkRefresh();
    const r1 = await rotateRefreshToken({ token: rt1, clientId: "client_a" });
    if (!r1.ok) throw new Error("rotation should succeed");

    // Replay of rt1 — this is what a thief holding the old token does.
    await rotateRefreshToken({ token: rt1, clientId: "client_a" });

    // The legitimate successor must now be dead too: thief and victim both
    // lose, and the user re-consents.
    const afterTheft = await rotateRefreshToken({ token: r1.refreshToken, clientId: "client_a" });
    expect(afterTheft).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects rotation by a different client", async () => {
    const rt = await mkRefresh();
    const r = await rotateRefreshToken({ token: rt, clientId: "client_b" });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects an unknown token", async () => {
    const r = await rotateRefreshToken({ token: "rt_nope", clientId: "client_a" });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("RFC 7009 revocation kills the token and its family", async () => {
    const rt1 = await mkRefresh();
    const r1 = await rotateRefreshToken({ token: rt1, clientId: "client_a" });
    if (!r1.ok) throw new Error("rotation should succeed");

    const owner = await revokeRefreshToken(r1.refreshToken);
    expect(owner).toBe("user_1");

    const afterRevoke = await rotateRefreshToken({ token: r1.refreshToken, clientId: "client_a" });
    expect(afterRevoke).toMatchObject({ ok: false, error: "invalid_grant" });
  });
});

// ---------------------------------------------------------------------------
// Durable session revocation: the jti lands on the kv denylist (cross-instance
// in prod), and a durable verify rejects the token afterwards.
// ---------------------------------------------------------------------------

describe("durable session revocation", () => {
  it("revoked jti is written to kv and the token stops verifying", async () => {
    const jti = crypto.randomUUID();
    const token = await signSession({ sub: "user_1", jti });
    expect((await verifySession(token, { durable: true }))?.sub).toBe("user_1");

    await revokeSession(jti);
    expect(await kvGet(`session:revoked:${jti}`)).not.toBeNull(); // the durable half
    expect(await verifySession(token, { durable: true })).toBeNull();
  });

  it("a revoked MCP access token stops working as a connector credential", async () => {
    const access = await issueAccessToken("user_1", ["wallets:read"]);
    const claims = await verifyAccessToken(access);
    expect(claims?.sub).toBe("user_1");

    await revokeSession(claims?.jti);
    expect(await verifyAccessToken(access)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The route→scope firewall. THE invariant: an MCP token is NOT a session — it
// reaches exactly the routes its tools call, with the scopes the user granted,
// and nothing else.
// ---------------------------------------------------------------------------

const mcpClaims = (scopes: McpClaims["scopes"]): McpClaims =>
  ({ sub: "user_1", mcp: true, scopes } as McpClaims);

describe("MCP route→scope firewall", () => {
  it("maps the tool-called routes to their tools' scopes", () => {
    expect(requiredScopeFor("GET", "/api/wallets")).toBe("wallets:read");
    expect(requiredScopeFor("POST", "/api/payments/create")).toBe("payments:write");
    expect(requiredScopeFor("get", "/api/overview")).toBe("wallets:read"); // method case-insensitive
  });

  it("DEFAULT-DENIES everything else — the money/security routes above all", () => {
    for (const [method, path] of [
      ["POST", "/api/payments/execute"],
      ["POST", "/api/security/mfa"],
      ["POST", "/api/wallets/transfer"],
      ["POST", "/api/swaps/execute"],
      ["DELETE", "/api/account"],
      ["POST", "/api/investing/order"],
      ["GET", "/api/profile"],
    ] as const) {
      expect(requiredScopeFor(method, path)).toBeNull();
      const denial = mcpDenialFor(mcpClaims(["payments:write", "wallets:read"]), method, path);
      expect(denial?.status).toBe(403);
    }
  });

  it("allows a call whose scope was granted", () => {
    expect(mcpDenialFor(mcpClaims(["wallets:read"]), "GET", "/api/wallets")).toBeNull();
  });

  it("403s a mapped route whose scope was NOT granted, with insufficient_scope", () => {
    const denial = mcpDenialFor(mcpClaims(["wallets:read"]), "POST", "/api/payments/create");
    expect(denial?.status).toBe(403);
    expect(denial?.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
  });

  it("a token with no scopes at all can do nothing", () => {
    expect(mcpDenialFor(mcpClaims([]), "GET", "/api/wallets")?.status).toBe(403);
    expect(mcpDenialFor(mcpClaims(undefined), "GET", "/api/wallets")?.status).toBe(403);
  });
});
