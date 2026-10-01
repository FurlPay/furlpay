import { NextRequest, NextResponse } from "next/server";
import { audit } from "./audit";
import { trustedClientIp } from "./clientIp";
import {
  touchApiKey,
  verifyApiKey,
  type ApiKeyDenial,
  type ApiKeyRecord,
  type ApiScope,
  type ApiKeyEnvironment,
} from "./apiKeys";

// ---------------------------------------------------------------------------
// Route-side enforcement for API keys.
//
// A permission that only exists in the create-key UI is not a permission; it
// is a label. This module is the half that makes `payments:create` mean
// something, so any scope offered in that UI must be checked through here at
// a real call site.
//
// A key is presented as `Authorization: Bearer <key>`. The header is chosen
// over a query parameter deliberately: a query string lands in access logs,
// browser history, and the Referer sent to every third party the page loads.
// ---------------------------------------------------------------------------

export type ApiKeyAuthResult =
  | { ok: true; record: ApiKeyRecord }
  | { ok: false; res: NextResponse };

/** Every denial that is not a scope problem answers 401 with one body. The
 *  caller learns that the credential did not work, and nothing else — a
 *  distinct message per cause would let an attacker sort real key ids from
 *  invented ones without ever holding a secret. */
const OPAQUE_401 = {
  error: "invalid_api_key",
  message: "The API key provided is not valid for this request.",
} as const;

/** Denials the caller is entitled to understand, because they are about a key
 *  the caller has already proven it holds. */
function isProvenHolder(reason: ApiKeyDenial): boolean {
  return (
    reason === "revoked" ||
    reason === "expired" ||
    reason === "wrong_environment" ||
    reason === "ip_not_allowed" ||
    reason === "origin_not_allowed" ||
    reason === "insufficient_scope"
  );
}

const DENIAL_MESSAGES: Record<ApiKeyDenial, string> = {
  malformed: "The API key provided is not valid for this request.",
  unknown_key: "The API key provided is not valid for this request.",
  bad_secret: "The API key provided is not valid for this request.",
  revoked: "This API key has been revoked.",
  expired: "This API key has expired.",
  wrong_environment: "This key belongs to a different environment than this endpoint serves.",
  ip_not_allowed: "This key is not permitted from this IP address.",
  origin_not_allowed: "This key is not permitted from this origin.",
  insufficient_scope: "This key does not carry the permission required for this request.",
};

export function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer" || rest.length !== 1) return null;
  return rest[0];
}

/** The client address as the platform reports it. */
export function clientIp(req: NextRequest): string | null {
  // One trust model for every IP decision (rate limits, this allowlist):
  // lib/clientIp.ts. null = not established, which an allowlist refuses.
  return trustedClientIp(req);
}

export interface RequireApiKeyOptions {
  scope: ApiScope;
  environment?: ApiKeyEnvironment;
}

/**
 * Authenticate and authorise a request carrying an API key.
 *
 * Returns 401 for anything that fails authentication and 403 for a key that
 * authenticated but may not do this. The split matters to a client: a 401
 * means "your credential is wrong", a 403 means "your credential is right and
 * the answer is still no", and retrying only makes sense for the first.
 */
export async function requireApiKey(
  req: NextRequest,
  opts: RequireApiKeyOptions
): Promise<ApiKeyAuthResult> {
  const presented = bearerToken(req);
  if (!presented) {
    return {
      ok: false,
      res: NextResponse.json(OPAQUE_401, {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="FurlPay"' },
      }),
    };
  }

  const ip = clientIp(req);
  const auth = await verifyApiKey(presented, {
    requiredScope: opts.scope,
    environment: opts.environment,
    ip,
    origin: req.headers.get("origin"),
  });

  if (!auth.ok) {
    const route = new URL(req.url).pathname;
    // The audit entry names the ROUTE and the reason, never the presented
    // string or any part of it. A rejected credential in a log is still a
    // credential.
    audit("apikey.auth_failed", "anonymous", { route, reason: auth.reason, ip });

    if (auth.reason === "insufficient_scope") {
      return {
        ok: false,
        res: NextResponse.json(
          {
            error: "insufficient_scope",
            message: DENIAL_MESSAGES.insufficient_scope,
            requiredScope: opts.scope,
          },
          { status: 403 }
        ),
      };
    }
    const body = isProvenHolder(auth.reason)
      ? { error: auth.reason, message: DENIAL_MESSAGES[auth.reason] }
      : OPAQUE_401;
    const status = isProvenHolder(auth.reason) ? 403 : 401;
    return {
      ok: false,
      res: NextResponse.json(body, {
        status,
        ...(status === 401 ? { headers: { "WWW-Authenticate": 'Bearer realm="FurlPay"' } } : {}),
      }),
    };
  }

  // Usage telemetry is fire-and-forget. Awaiting it would put a KV write on
  // the latency path of every authenticated request, and a failed write must
  // never turn a valid key into a rejected one.
  void touchApiKey(auth.record.keyId, { route: new URL(req.url).pathname, ip });

  return { ok: true, record: auth.record };
}
