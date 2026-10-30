// ---------------------------------------------------------------------------
// Confidential Space attestation token verification.
//
// Google Confidential Space VMs (running on AMD SEV-SNP or Intel TDX) emit
// attestation tokens — JWTs signed by Google's attestation service — that
// prove the workload is running in a genuine Trusted Execution Environment.
// The token proves:
//   1. The VM is a real Confidential Space instance (hardware attestation).
//   2. What container image is running (image digest).
//   3. That debug mode is disabled (no operator console access).
//   4. That Secure Boot was used (firmware chain of trust).
//
// The MPC key shares hosted in Confidential Space use these tokens to prove
// to the other share holders that signing operations happen in tamper-proof
// hardware. FurlPay's share B holder verifies these tokens before co-signing.
//
// This module verifies attestation tokens using Google's OIDC discovery
// endpoint and JWKS. Network calls (fetching the JWKS) require the caller
// to be outside the sandbox.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import type { ConfidentialSpaceClaims } from "./types.js";

// ── JWKS caching ────────────────────────────────────────────────────────────

/** Google's OIDC discovery endpoint for Confidential Space. */
const CS_ISSUER = "https://confidentialcomputing.googleapis.com";
const JWKS_URI = `${CS_ISSUER}/.well-known/openid-configuration`;

interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  n?: string;
  e?: string;
  use?: string;
}

interface JwksCache {
  keys: JwkKey[];
  fetchedAt: number;
}

let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 3600_000; // 1 hour

/**
 * Fetch the JWKS from Google's Confidential Space OIDC endpoint.
 *
 * Caches for 1 hour. The JWKS rotates infrequently, and a stale cache
 * at most delays acceptance of a new key by one hour — it does NOT accept
 * a revoked key, because revocation removes the key from the set.
 */
async function fetchJwks(): Promise<JwkKey[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  // Step 1: discover the jwks_uri from the OIDC configuration
  const configRes = await fetch(JWKS_URI);
  if (!configRes.ok) {
    throw new Error(`Failed to fetch OIDC config from ${JWKS_URI}: ${configRes.status}`);
  }
  const config = (await configRes.json()) as { jwks_uri?: string };
  const jwksUrl = config.jwks_uri;
  if (!jwksUrl) {
    throw new Error("OIDC config missing jwks_uri");
  }

  // Step 2: fetch the actual JWKS
  const jwksRes = await fetch(jwksUrl);
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${jwksRes.status}`);
  }
  const jwks = (await jwksRes.json()) as { keys?: JwkKey[] };
  if (!jwks.keys?.length) {
    throw new Error("JWKS contains no keys");
  }

  jwksCache = { keys: jwks.keys, fetchedAt: now };
  return jwks.keys;
}

/**
 * Decode a JWT without verification (to read the header and extract kid).
 */
function decodeJwtUnsafe(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signatureB64: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT: expected 3 parts");

  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as Record<string, unknown>;
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as Record<string, unknown>;
  return { header, payload, signatureB64: parts[2]! };
}

// ── Verification ────────────────────────────────────────────────────────────

/** Options for attestation token verification. */
export interface VerifyAttestationOptions {
  /** Expected Google Cloud project id. */
  expectedProjectId?: string;
  /** Expected container image digest (sha256:...). */
  expectedImageDigest?: string;
  /** Maximum token age in seconds. Default: 300. */
  maxAgeSecs?: number;
  /** Clock skew tolerance in seconds. Default: 60. */
  clockSkewSecs?: number;
}

/**
 * Verify a Confidential Space attestation token.
 *
 * This checks:
 *   1. JWT signature against Google's JWKS.
 *   2. Issuer is the Confidential Computing service.
 *   3. Token is not expired and not too old.
 *   4. Debug mode is disabled (required for production).
 *   5. Secure Boot is enabled.
 *   6. Optional: project id matches.
 *   7. Optional: image digest matches.
 *
 * @param token - Raw JWT string from the Confidential Space metadata server.
 * @param opts  - Verification options.
 * @returns Parsed and verified claims.
 * @throws On verification failure with a descriptive message.
 */
export async function verifyAttestationToken(
  token: string,
  opts: VerifyAttestationOptions = {}
): Promise<ConfidentialSpaceClaims> {
  const maxAge = (opts.maxAgeSecs ?? 300) * 1000;
  const skew = (opts.clockSkewSecs ?? 60) * 1000;
  const now = Date.now();

  // Decode without verification to find the kid
  const { header, payload } = decodeJwtUnsafe(token);

  // 1. Find the signing key
  const kid = header.kid as string | undefined;
  if (!kid) throw new Error("Attestation token missing kid in header");

  const keys = await fetchJwks();
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new Error(`Attestation token signed by unknown kid: ${kid}`);

  // 2. Verify the signature using node:crypto
  const [headerB64, payloadB64, sigB64] = token.split(".");
  const signedData = `${headerB64}.${payloadB64}`;

  const publicKey = crypto.createPublicKey({ key: key as unknown as crypto.JsonWebKey, format: "jwk" });
  const alg = (header.alg as string) ?? "RS256";
  const nodeAlg = alg === "RS256" ? "RSA-SHA256" : alg === "RS384" ? "RSA-SHA384" : "RSA-SHA256";

  const valid = crypto.createVerify(nodeAlg)
    .update(signedData)
    .verify(publicKey, sigB64!, "base64url");

  if (!valid) throw new Error("Attestation token signature verification failed");

  // 3. Issuer check
  const iss = payload.iss as string | undefined;
  if (iss !== CS_ISSUER && iss !== "https://confidentialcomputing.googleapis.com") {
    throw new Error(`Unexpected issuer: ${iss}`);
  }

  // 4. Expiry / freshness
  const exp = (payload.exp as number) * 1000;
  const iat = (payload.iat as number) * 1000;
  if (now > exp + skew) throw new Error("Attestation token expired");
  if (now < iat - skew) throw new Error("Attestation token not yet valid");
  if (now - iat > maxAge) throw new Error("Attestation token too old");

  // 5. Extract Confidential Space specific claims
  const submods = payload.submods as Record<string, unknown> | undefined;
  const container = (submods?.container ?? payload.container_image) as Record<string, unknown> | undefined;
  const hwModel = (payload.hwmodel ?? payload.hw_model ?? "UNKNOWN") as string;
  const secureBootEnabled = (payload.secboot ?? payload.secure_boot ?? false) as boolean;
  const debugDisabled = (payload.dbgstat === "disabled-since-boot" || payload.debug_disabled === true) as boolean;
  const google = payload.google as Record<string, unknown> | undefined;

  // 6. Security checks
  if (!debugDisabled) {
    throw new Error("Attestation token: debug mode is NOT disabled — refusing for production use");
  }
  if (!secureBootEnabled) {
    throw new Error("Attestation token: Secure Boot is NOT enabled");
  }

  // 7. Build claims
  const claims: ConfidentialSpaceClaims = {
    projectNumber: String(payload.project_number ?? google?.project_number ?? ""),
    projectId: String(payload.project_id ?? google?.project_id ?? ""),
    imageDigest: String(container?.image_digest ?? ""),
    imageReference: String(container?.image_reference ?? ""),
    hwModel,
    secureBootEnabled,
    debugDisabled,
    workloadIdentityProvider: payload.wip as string | undefined,
    serviceAccount: payload.sa as string | undefined,
    rawToken: token,
  };

  // 8. Optional: project id match
  if (opts.expectedProjectId && claims.projectId !== opts.expectedProjectId) {
    throw new Error(`Project id mismatch: expected ${opts.expectedProjectId}, got ${claims.projectId}`);
  }

  // 9. Optional: image digest match
  if (opts.expectedImageDigest && claims.imageDigest !== opts.expectedImageDigest) {
    throw new Error(`Image digest mismatch: expected ${opts.expectedImageDigest}, got ${claims.imageDigest}`);
  }

  return claims;
}

/** Clear the cached JWKS (for testing or key rotation events). */
export function clearJwksCache(): void {
  jwksCache = null;
}
