import { keyIdOf, verifyRequest } from "@furlpay/agent-trust";

// TAP-style HTTP gate for API routes: agents register an Ed25519 public key,
// then sign requests with RFC 9421 headers (@furlpay/agent-trust signRequest).
// globalThis singleton — Next bundles each route separately, so module-level
// state would not be shared across routes (same pattern as lib/travel/store).

const g = globalThis as unknown as { __agentTrustKeys?: Map<string, string> };
const keys = () => (g.__agentTrustKeys ??= new Map<string, string>());

export function registerAgentKey(publicKeyPem: string): string {
  const keyId = keyIdOf(publicKeyPem, "agent");
  keys().set(keyId, publicKeyPem);
  return keyId;
}

export function listAgentKeyIds(): string[] {
  return [...keys().keys()];
}

/**
 * Verify a request's RFC 9421 signature against the registered agent keys.
 * Returns the verified agent keyId, or null when the request is unsigned
 * (demo back-compat — set FURLPAY_REQUIRE_AGENT_SIG=1 to reject unsigned).
 * Throws when a signature is present but invalid, expired, or from an
 * unknown key, or when the body was tampered (content-digest mismatch).
 */
export function verifyAgentSignature(
  req: { method: string; url: string; headers: Headers },
  rawBody: string,
): string | null {
  if (!req.headers.get("signature-input")) {
    if (process.env.FURLPAY_REQUIRE_AGENT_SIG === "1") {
      throw new Error("agent signature required (RFC 9421 Signature-Input missing)");
    }
    return null;
  }
  const verified = verifyRequest({
    method: req.method,
    url: req.url,
    body: rawBody,
    headers: {
      "signature-input": req.headers.get("signature-input") ?? undefined,
      signature: req.headers.get("signature") ?? undefined,
      "content-digest": req.headers.get("content-digest") ?? undefined,
    },
    resolvePublicKey: (id) => keys().get(id),
  });
  return verified.keyId;
}
