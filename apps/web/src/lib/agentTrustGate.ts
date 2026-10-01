import { publicRequestUrl } from "./publicOrigin";
import { keyIdOf, verifyRequest } from "@furlpay/agent-trust";
import { getAgentKey } from "./agentPolicy";

// TAP-style HTTP gate for API routes: agents register an Ed25519 public key,
// then sign requests with RFC 9421 headers (@furlpay/agent-trust signRequest).
//
// Keys resolve from the durable agentPolicy records first (user-owned, with
// spend policies — registered via POST /api/agents/keys), falling back to the
// legacy anonymous in-memory registry for pre-policy demo keys.
// globalThis singleton — Next bundles each route separately, so module-level
// state would not be shared across routes (same pattern as lib/travel/store).

const g = globalThis as unknown as { __agentTrustKeys?: Map<string, string> };
const keys = () => (g.__agentTrustKeys ??= new Map<string, string>());

/** Legacy anonymous registration (in-memory, this instance only). Owned keys
 *  with policies go through agentPolicy.registerOwnedAgentKey instead. */
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
export async function verifyAgentSignature(
  req: { method: string; url: string; headers: Headers },
  rawBody: string,
): Promise<string | null> {
  const sigInput = req.headers.get("signature-input");
  if (!sigInput) {
    if (process.env.FURLPAY_REQUIRE_AGENT_SIG === "1") {
      throw new Error("agent signature required (RFC 9421 Signature-Input missing)");
    }
    return null;
  }

  // verifyRequest's resolver is sync, so prefetch the durable record for the
  // keyid named in the header. A revoked key must not verify — revocation is
  // a security boundary, not just a spend-policy one.
  const claimedKeyId = sigInput.match(/;keyid="([^"]+)"/)?.[1];
  const owned = claimedKeyId ? await getAgentKey(claimedKeyId) : null;

  const verified = verifyRequest({
    method: req.method,
    // The signed @target-uri is the PUBLIC URL (on ECS req.url is the bind address).
    url: publicRequestUrl(req).toString(),
    body: rawBody,
    headers: {
      "signature-input": req.headers.get("signature-input") ?? undefined,
      signature: req.headers.get("signature") ?? undefined,
      "content-digest": req.headers.get("content-digest") ?? undefined,
    },
    resolvePublicKey: (id) =>
      owned && owned.keyId === id && owned.status === "active"
        ? owned.publicKeyPem
        : keys().get(id),
  });
  return verified.keyId;
}
