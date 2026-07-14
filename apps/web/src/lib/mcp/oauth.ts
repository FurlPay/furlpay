import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { kvDel, kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { signSession, verifySession, type SessionClaims } from "@/lib/session";

// ---------------------------------------------------------------------------
// OAuth 2.1 + PKCE for the remote MCP connector.
//
// Claude (web/desktop/mobile/Code) is a PUBLIC client: it holds no secret, so
// PKCE (RFC 7636, S256 only) is the proof — not a client secret. Clients
// register dynamically (RFC 7591) because we cannot pre-provision every
// installation of Claude Code on every machine.
//
// The redirect_uri is the whole ballgame: a permissive rule here hands an
// attacker the authorization code and therefore the user's money. The rule is:
//
//   * https://claude.ai/api/mcp/auth_callback and the claude.com twin —
//     exact-match, no wildcards.
//   * http://localhost:<any-port>/... and 127.0.0.1 / [::1] — port-wildcarded
//     ONLY because a CLI's loopback listener binds an ephemeral port and
//     cannot know it at registration time. Loopback is not attacker-reachable
//     from another origin, which is what makes the port wildcard safe. Every
//     other host, scheme, or a loopback URL over https/with credentials is
//     rejected.
//
// Access tokens are the app's own session JWTs (so every downstream route's
// requireUser works unchanged) but carry `mcp: true` and the granted scopes, so
// a connector token can be told apart from a browser session and constrained.
// ---------------------------------------------------------------------------

export const CLAUDE_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

/** Scopes a client may request. Money-moving tools require `payments:write`. */
export const SCOPES = [
  "profile:read",
  "wallets:read",
  "transactions:read",
  "travel:read",
  "payments:write",
  "travel:write",
] as const;
export type Scope = (typeof SCOPES)[number];

/** Read-only by default: a client that asks for nothing gets nothing dangerous. */
export const DEFAULT_SCOPES: Scope[] = ["profile:read", "wallets:read", "transactions:read", "travel:read"];

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

const clientKey = (id: string) => `mcp:oauth:client:${id}`;
const codeKey = (code: string) => `mcp:oauth:code:${code}`;
const CODE_TTL = 300; // 5 minutes — an authorization code is single-use and short-lived
const CLIENT_TTL = 90 * 24 * 3600;

// --- redirect_uri validation -------------------------------------------------

/**
 * Is this a redirect_uri we will ever send a code to?
 *
 * Exported for its test: this predicate is the boundary between "Claude gets the
 * code" and "an attacker gets the code".
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (CLAUDE_CALLBACKS.includes(uri as (typeof CLAUDE_CALLBACKS)[number])) return true;

  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  // Loopback only, plain http only (TLS to yourself buys nothing and https +
  // a wildcard port would let a hostile local service impersonate the CLI).
  if (u.protocol !== "http:") return false;
  const host = u.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!loopback) return false;
  // No credentials, no query, no fragment — a code must not land in a URL that
  // already carries attacker-chosen material.
  if (u.username || u.password || u.search || u.hash) return false;
  return true;
}

/** Exact match, except loopback where the PORT (and only the port) may differ. */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  if (!isAllowedRedirectUri(requested) || !isAllowedRedirectUri(registered)) return false;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    const bothLoopback = [a.hostname, b.hostname].every(
      (h) => h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]"
    );
    return bothLoopback && a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

// --- dynamic client registration (RFC 7591) ----------------------------------

export async function registerClient(input: {
  client_name: string;
  redirect_uris: string[];
}): Promise<OAuthClient | { error: string }> {
  if (!input.redirect_uris.length) return { error: "redirect_uris is required" };
  if (input.redirect_uris.length > 8) return { error: "too many redirect_uris" };
  for (const uri of input.redirect_uris) {
    if (!isAllowedRedirectUri(uri)) return { error: `redirect_uri not allowed: ${uri}` };
  }
  const client: OAuthClient = {
    client_id: `mcp_${randomUUID()}`,
    client_name: input.client_name.slice(0, 120),
    redirect_uris: input.redirect_uris,
    created_at: new Date().toISOString(),
  };
  await kvSet(clientKey(client.client_id), client, CLIENT_TTL);
  return client;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  return kvGet<OAuthClient>(clientKey(clientId));
}

// --- authorization codes (PKCE) ----------------------------------------------

interface AuthCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string; // S256 only
  scopes: Scope[];
}

export async function issueCode(input: AuthCode): Promise<string> {
  const code = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await kvSet(codeKey(code), input, CODE_TTL);
  return code;
}

/**
 * Redeem an authorization code exactly once, verifying the PKCE challenge.
 *
 * Single-use is enforced with an atomic kvSetNx claim BEFORE the code is read,
 * so two concurrent redemptions cannot both succeed (a replayed code is exactly
 * what an interception attack replays).
 */
export async function redeemCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ ok: true; userId: string; scopes: Scope[] } | { ok: false; error: string }> {
  const claimed = await kvSetNx(`${codeKey(input.code)}:used`, "1", CODE_TTL);
  if (!claimed) return { ok: false, error: "invalid_grant" }; // replay

  const record = await kvGet<AuthCode>(codeKey(input.code));
  await kvDel(codeKey(input.code));
  if (!record) return { ok: false, error: "invalid_grant" };
  if (record.clientId !== input.clientId) return { ok: false, error: "invalid_grant" };
  if (!redirectUriMatches(record.redirectUri, input.redirectUri)) return { ok: false, error: "invalid_grant" };

  // PKCE S256: BASE64URL(SHA256(verifier)) must equal the stored challenge.
  const computed = createHash("sha256").update(input.codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(record.codeChallenge);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "invalid_grant" };

  return { ok: true, userId: record.userId, scopes: record.scopes };
}

// --- access tokens ------------------------------------------------------------

export interface McpClaims extends SessionClaims {
  mcp?: true;
  scopes?: Scope[];
}

/** Mint a connector access token: a normal session JWT marked `mcp` + scoped. */
export async function issueAccessToken(userId: string, scopes: Scope[], safe?: string): Promise<string> {
  return signSession({ sub: userId, ...(safe ? { safe } : {}), mcp: true, scopes } as McpClaims);
}

/** Verify a connector bearer token. Rejects non-MCP session tokens: a browser
 *  cookie must not be usable as a connector credential. */
export async function verifyAccessToken(token: string | undefined): Promise<McpClaims | null> {
  const claims = (await verifySession(token)) as McpClaims | null;
  if (!claims?.sub || claims.mcp !== true) return null;
  return claims;
}

export function hasScope(claims: McpClaims, scope: Scope): boolean {
  return (claims.scopes ?? []).includes(scope);
}

/** Parse a requested scope string, dropping anything unrecognized. */
export function parseScopes(raw: string | null | undefined): Scope[] {
  if (!raw) return DEFAULT_SCOPES;
  const asked = raw.split(/[\s+]+/).filter(Boolean);
  const granted = asked.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  return granted.length ? granted : DEFAULT_SCOPES;
}
