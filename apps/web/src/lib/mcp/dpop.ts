import { createHash, timingSafeEqual } from "crypto";
import { EmbeddedJWK, calculateJwkThumbprint, jwtVerify, type JWK, type JWTPayload } from "jose";
import { kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// DPoP (RFC 9449) proof-of-possession for the remote MCP connector.
//
// A plain Bearer token is a password: whoever holds the string can spend it.
// A DPoP-bound token is useless without the private key it was minted against
// — the client signs a fresh proof JWT per request, and the server checks the
// proof's public-key thumbprint matches the `cnf.jkt` baked into the token.
// A token leaked from a log or a proxy can no longer move money from another
// machine.
//
// Rollout is opportunistic and backward-compatible: a token is bound ONLY when
// the client offers a proof at the token endpoint, and enforcement kicks in
// ONLY for tokens that carry a binding. Existing Bearer connectors keep
// working; DPoP-capable clients get replay protection for free.
// ---------------------------------------------------------------------------

const PROOF_TYP = "dpop+jwt";
// Asymmetric signature algorithms only. HS* is deliberately excluded: a proof
// is self-signed by the key embedded in its own header, so a symmetric alg
// would let an attacker sign with a key of their choosing.
const ALLOWED_ALGS = ["ES256", "ES384", "ES512", "PS256", "RS256", "EdDSA"];
// A proof is accepted within this age; the jti replay-cache TTL must cover it.
const MAX_PROOF_AGE_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;
const JTI_TTL_SECONDS = MAX_PROOF_AGE_SECONDS + CLOCK_TOLERANCE_SECONDS + 30;

export class DpopError extends Error {}

interface DpopProofClaims extends JWTPayload {
  htm?: string; // HTTP method the proof is bound to
  htu?: string; // HTTP URI the proof is bound to (no query/fragment)
  ath?: string; // base64url(SHA-256(access_token)) — present for resource access
}

/** base64url(SHA-256(token)) — the `ath` claim binds a proof to one token. */
export function accessTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Canonical htu: scheme + host + path, no query, no fragment (RFC 9449 §4.2). */
function normalizeHtu(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.toString();
}

function equalConstantTime(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verify a DPoP proof and return the public-key thumbprint (`jkt`).
 *
 * Throws DpopError on any failure. Callers translate that into a 401 with a
 * `DPoP` challenge — never leak which specific check failed to the client.
 *
 * @param proof  the raw `DPoP` header value (a compact JWS)
 * @param htm    the actual HTTP method of the request being authorized
 * @param htu    the actual request URL (query/fragment are stripped internally)
 * @param accessToken  when verifying resource access, the bound token — the
 *                     proof's `ath` must hash to it
 * @param expectedJkt  when the token carries `cnf.jkt`, the proof's key
 *                     thumbprint must equal it
 */
export async function verifyDpopProof(
  proof: string,
  opts: { htm: string; htu: string; accessToken?: string; expectedJkt?: string }
): Promise<{ jkt: string }> {
  if (!proof || proof.split(".").length !== 3) {
    throw new DpopError("malformed DPoP proof");
  }

  let payload: DpopProofClaims;
  let jwk: JWK | undefined;
  try {
    // EmbeddedJWK verifies the signature against the public key in the proof's
    // own `jwk` header. typ is pinned; iat age is enforced via maxTokenAge.
    const result = await jwtVerify(proof, EmbeddedJWK, {
      typ: PROOF_TYP,
      algorithms: ALLOWED_ALGS,
      maxTokenAge: `${MAX_PROOF_AGE_SECONDS}s`,
      clockTolerance: `${CLOCK_TOLERANCE_SECONDS}s`,
    });
    payload = result.payload as DpopProofClaims;
    jwk = result.protectedHeader.jwk;
  } catch {
    throw new DpopError("invalid DPoP proof signature or age");
  }

  // The embedded key must be a PUBLIC key. A proof that ships private material
  // is malformed and a sign of a broken/hostile client.
  if (!jwk || typeof jwk !== "object" || "d" in jwk) {
    throw new DpopError("DPoP proof must embed a public JWK");
  }

  // htm / htu must match the request this proof is presented on.
  if (typeof payload.htm !== "string" || payload.htm.toUpperCase() !== opts.htm.toUpperCase()) {
    throw new DpopError("DPoP htm mismatch");
  }
  if (typeof payload.htu !== "string" || normalizeHtu(payload.htu) !== normalizeHtu(opts.htu)) {
    throw new DpopError("DPoP htu mismatch");
  }

  // jti replay defense: one proof, one use, within the acceptance window.
  if (typeof payload.jti !== "string" || payload.jti.length < 8 || payload.jti.length > 200) {
    throw new DpopError("DPoP jti missing or invalid");
  }
  const fresh = await kvSetNx(`mcp:dpop:jti:${payload.jti}`, 1, JTI_TTL_SECONDS);
  if (!fresh) throw new DpopError("DPoP proof replayed");

  // Resource access binds the proof to a specific access token via `ath`.
  if (opts.accessToken !== undefined) {
    const expectedAth = accessTokenHash(opts.accessToken);
    if (typeof payload.ath !== "string" || !equalConstantTime(payload.ath, expectedAth)) {
      throw new DpopError("DPoP ath mismatch");
    }
  }

  const jkt = await calculateJwkThumbprint(jwk, "sha256");

  // When the token declares a key binding, the proof's key must be that key.
  if (opts.expectedJkt !== undefined && !equalConstantTime(jkt, opts.expectedJkt)) {
    throw new DpopError("DPoP key thumbprint does not match token binding");
  }

  return { jkt };
}
