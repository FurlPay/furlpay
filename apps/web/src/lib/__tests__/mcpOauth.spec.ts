import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOPES,
  isAllowedRedirectUri,
  issueAccessToken,
  issueCode,
  parseScopes,
  redeemCode,
  redirectUriMatches,
  registerClient,
  verifyAccessToken,
} from "@/lib/mcp/oauth";
import { createHash, randomBytes } from "crypto";

// The redirect_uri predicate decides whether Claude gets the authorization code
// or an attacker does. These are the cases that matter.

describe("redirect_uri allowlist", () => {
  it("accepts the exact Claude callbacks", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback")).toBe(true);
  });

  it("accepts loopback on any port (the CLI's ephemeral listener)", () => {
    expect(isAllowedRedirectUri("http://localhost:49213/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:5000/callback")).toBe(true);
  });

  it("rejects every non-loopback, non-Claude host", () => {
    for (const bad of [
      "https://evil.com/callback",
      "http://evil.com/callback",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "https://evil.com/?x=https://claude.ai/api/mcp/auth_callback",
      "http://localhost.evil.com/callback",
      "http://127.0.0.1.evil.com/callback",
      "javascript:alert(1)",
      "data:text/html,x",
      "not a url",
    ]) {
      expect(isAllowedRedirectUri(bad)).toBe(false);
    }
  });

  it("rejects a Claude callback with anything appended (no prefix matching)", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback/../../evil")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback?next=https://evil.com")).toBe(false);
  });

  it("rejects loopback URLs carrying credentials, query or fragment", () => {
    expect(isAllowedRedirectUri("http://user:pass@localhost:3000/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://localhost:3000/callback?next=https://evil.com")).toBe(false);
    expect(isAllowedRedirectUri("http://localhost:3000/callback#x")).toBe(false);
  });

  it("rejects https loopback with a wildcard port (a local attacker could bind it)", () => {
    expect(isAllowedRedirectUri("https://localhost:1234/callback")).toBe(false);
  });

  it("matches loopback only on port, never on host or path", () => {
    expect(redirectUriMatches("http://localhost:1111/callback", "http://localhost:2222/callback")).toBe(true);
    expect(redirectUriMatches("http://localhost:1111/callback", "http://localhost:2222/other")).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:1111/cb", "http://localhost:1111/cb")).toBe(false);
    expect(
      redirectUriMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback")
    ).toBe(false);
  });
});

describe("dynamic client registration", () => {
  it("refuses to register a client with a disallowed redirect_uri", async () => {
    const r = await registerClient({ client_name: "evil", redirect_uris: ["https://evil.com/cb"] });
    expect(r).toHaveProperty("error");
  });

  it("registers a well-formed client", async () => {
    const r = await registerClient({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(r).toHaveProperty("client_id");
  });
});

describe("PKCE code exchange", () => {
  const verifier = randomBytes(40).toString("base64url"); // 43-128 unreserved chars
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";

  const mkCode = () =>
    issueCode({
      clientId: "client_a",
      userId: "user_1",
      redirectUri,
      codeChallenge: challenge,
      scopes: ["wallets:read"],
    });

  it("redeems once with the correct verifier", async () => {
    const code = await mkCode();
    const r = await redeemCode({ code, clientId: "client_a", redirectUri, codeVerifier: verifier });
    expect(r).toMatchObject({ ok: true, userId: "user_1", scopes: ["wallets:read"] });
  });

  it("REJECTS a replay of the same code (single-use)", async () => {
    const code = await mkCode();
    const first = await redeemCode({ code, clientId: "client_a", redirectUri, codeVerifier: verifier });
    expect(first.ok).toBe(true);
    const replay = await redeemCode({ code, clientId: "client_a", redirectUri, codeVerifier: verifier });
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects a wrong PKCE verifier (stolen code without the verifier is useless)", async () => {
    const code = await mkCode();
    const r = await redeemCode({
      code,
      clientId: "client_a",
      redirectUri,
      codeVerifier: randomBytes(40).toString("base64url"),
    });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects redemption by a different client", async () => {
    const code = await mkCode();
    const r = await redeemCode({ code, clientId: "client_b", redirectUri, codeVerifier: verifier });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects redemption against a different redirect_uri", async () => {
    const code = await mkCode();
    const r = await redeemCode({
      code,
      clientId: "client_a",
      redirectUri: "https://claude.com/api/mcp/auth_callback",
      codeVerifier: verifier,
    });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects an unknown code", async () => {
    const r = await redeemCode({ code: "nope", clientId: "client_a", redirectUri, codeVerifier: verifier });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("access tokens", () => {
  it("mints a scoped MCP token that verifies", async () => {
    const token = await issueAccessToken("user_1", ["wallets:read"], "0xabc");
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe("user_1");
    expect(claims?.scopes).toEqual(["wallets:read"]);
  });

  it("rejects a plain session token as a connector credential", async () => {
    const { signSession } = await import("@/lib/session");
    const browserToken = await signSession({ sub: "user_1" });
    expect(await verifyAccessToken(browserToken)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyAccessToken("not.a.token")).toBeNull();
    expect(await verifyAccessToken(undefined)).toBeNull();
  });
});

describe("scope parsing", () => {
  it("falls back to read-only defaults", () => {
    expect(parseScopes(null)).toEqual(DEFAULT_SCOPES);
    expect(parseScopes("")).toEqual(DEFAULT_SCOPES);
  });

  it("drops unknown scopes and never invents payments:write", () => {
    expect(parseScopes("wallets:read admin:all")).toEqual(["wallets:read"]);
    expect(parseScopes("bogus")).toEqual(DEFAULT_SCOPES);
    expect(parseScopes(DEFAULT_SCOPES.join(" "))).not.toContain("payments:write");
  });

  it("honours an explicit payments:write request", () => {
    expect(parseScopes("wallets:read payments:write")).toContain("payments:write");
  });
});
