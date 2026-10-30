// ---------------------------------------------------------------------------
// Anchorage Digital Ed25519 request signing.
//
// Anchorage authenticates API requests with Ed25519 signatures — the same
// algorithm @furlpay/agent-trust uses for agent identity, so the cryptographic
// primitives are well-tested in this codebase.
//
// Protocol:
//   1. Build a canonical request string: METHOD\nPATH\nTIMESTAMP\nBODY_HASH
//   2. Sign the canonical string with the Ed25519 private key.
//   3. Send headers: Api-Access-Key, Api-Signature (base64), Api-Timestamp.
//
// The Ed25519 private key is provided during institutional onboarding and
// must be stored in a secure vault (not in source code or .env files in
// production — use a secrets manager).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

/**
 * Build the canonical request string that Anchorage expects to be signed.
 *
 * Format: `METHOD\nPATH\nTIMESTAMP\nBODY_HASH`
 *
 * - METHOD: uppercase HTTP method (GET, POST, etc.)
 * - PATH: request path including query string (e.g. "/v2/vaults?limit=10")
 * - TIMESTAMP: Unix timestamp in seconds (same as Api-Timestamp header)
 * - BODY_HASH: SHA-256 hex digest of the request body, or empty string for
 *   bodiless requests
 */
export function canonicalRequest(
  method: string,
  path: string,
  timestamp: number,
  body?: string | Buffer
): string {
  const bodyHash = body
    ? crypto.createHash("sha256").update(typeof body === "string" ? body : new Uint8Array(body)).digest("hex")
    : "";
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

/**
 * Sign a canonical request string with an Ed25519 private key.
 *
 * @param canonical   - The canonical request string from `canonicalRequest()`.
 * @param privateKey  - Ed25519 private key in PEM format.
 * @returns Base64-encoded Ed25519 signature.
 */
export function signCanonical(canonical: string, privateKey: string): string {
  const key = crypto.createPrivateKey(privateKey);
  const sig = crypto.sign(null, new Uint8Array(Buffer.from(canonical)), key);
  return sig.toString("base64");
}

/**
 * Verify an Ed25519 signature over a canonical request.
 *
 * Used for webhook verification and for testing request signing.
 *
 * @param canonical  - The canonical request string.
 * @param signature  - Base64-encoded Ed25519 signature.
 * @param publicKey  - Ed25519 public key in PEM format.
 * @returns True if the signature is valid.
 */
export function verifyCanonical(
  canonical: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const key = crypto.createPublicKey(publicKey);
    return crypto.verify(null, new Uint8Array(Buffer.from(canonical)), key, new Uint8Array(Buffer.from(signature, "base64")));
  } catch {
    return false;
  }
}

/**
 * Generate the authentication headers for an Anchorage API request.
 *
 * @param method     - HTTP method.
 * @param path       - Request path (including query string).
 * @param apiKey     - Anchorage API access key.
 * @param privateKey - Ed25519 private key in PEM format.
 * @param body       - Request body (if any).
 * @returns Headers to include in the request.
 */
export function authHeaders(
  method: string,
  path: string,
  apiKey: string,
  privateKey: string,
  body?: string | Buffer
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const canonical = canonicalRequest(method, path, timestamp, body);
  const signature = signCanonical(canonical, privateKey);

  return {
    "Api-Access-Key": apiKey,
    "Api-Signature": signature,
    "Api-Timestamp": String(timestamp),
  };
}
