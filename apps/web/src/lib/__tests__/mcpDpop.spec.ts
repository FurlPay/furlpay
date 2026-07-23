import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from "jose";
import { accessTokenHash, DpopError, verifyDpopProof } from "@/lib/mcp/dpop";

// A DPoP proof is a compact JWS the client signs per request with a key it
// holds privately, embedding the matching public key in the header. These
// tests forge proofs the way a real MCP client would, then assert the server
// accepts only well-formed, fresh, correctly-bound ones.

const HTU = "https://furlpay.com/api/mcp";

async function keypair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  const jkt = await calculateJwkThumbprint(publicJwk as JWK, "sha256");
  return { privateKey, publicJwk, jkt };
}

async function makeProof(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  publicJwk: JWK,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {}
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk, ...header })
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(privateKey);
}

describe("DPoP proof verification (RFC 9449)", () => {
  it("accepts a well-formed proof and returns the key thumbprint", async () => {
    const { privateKey, publicJwk, jkt } = await keypair();
    const proof = await makeProof(privateKey, publicJwk as JWK, { htm: "POST", htu: HTU });
    const result = await verifyDpopProof(proof, { htm: "POST", htu: HTU });
    expect(result.jkt).toBe(jkt);
  });

  it("rejects a replayed proof (same jti twice)", async () => {
    const { privateKey, publicJwk } = await keypair();
    const proof = await new SignJWT({ htm: "POST", htu: HTU })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk })
      .setIssuedAt()
      .setJti(randomUUID())
      .sign(privateKey);
    await expect(verifyDpopProof(proof, { htm: "POST", htu: HTU })).resolves.toBeTruthy();
    await expect(verifyDpopProof(proof, { htm: "POST", htu: HTU })).rejects.toBeInstanceOf(DpopError);
  });

  it("rejects an htu mismatch (proof minted for another URL)", async () => {
    const { privateKey, publicJwk } = await keypair();
    const proof = await makeProof(privateKey, publicJwk as JWK, {
      htm: "POST",
      htu: "https://evil.example/api/mcp",
    });
    await expect(verifyDpopProof(proof, { htm: "POST", htu: HTU })).rejects.toBeInstanceOf(DpopError);
  });

  it("rejects an htm mismatch", async () => {
    const { privateKey, publicJwk } = await keypair();
    const proof = await makeProof(privateKey, publicJwk as JWK, { htm: "GET", htu: HTU });
    await expect(verifyDpopProof(proof, { htm: "POST", htu: HTU })).rejects.toBeInstanceOf(DpopError);
  });

  it("ignores the query string when comparing htu", async () => {
    const { privateKey, publicJwk } = await keypair();
    const proof = await makeProof(privateKey, publicJwk as JWK, { htm: "POST", htu: HTU });
    await expect(
      verifyDpopProof(proof, { htm: "POST", htu: `${HTU}?session=abc` })
    ).resolves.toBeTruthy();
  });

  it("binds to an access token via ath — correct hash passes, wrong fails", async () => {
    const { privateKey, publicJwk } = await keypair();
    const token = "at_example_token_value";
    const good = await makeProof(privateKey, publicJwk as JWK, {
      htm: "POST",
      htu: HTU,
      ath: accessTokenHash(token),
    });
    await expect(
      verifyDpopProof(good, { htm: "POST", htu: HTU, accessToken: token })
    ).resolves.toBeTruthy();

    const bad = await makeProof(privateKey, publicJwk as JWK, {
      htm: "POST",
      htu: HTU,
      ath: accessTokenHash("a-different-token"),
    });
    await expect(
      verifyDpopProof(bad, { htm: "POST", htu: HTU, accessToken: token })
    ).rejects.toBeInstanceOf(DpopError);
  });

  it("rejects a proof whose key does not match the token binding (expectedJkt)", async () => {
    const a = await keypair();
    const b = await keypair();
    const proof = await makeProof(a.privateKey, a.publicJwk as JWK, { htm: "POST", htu: HTU });
    // Presented against a token bound to a DIFFERENT key.
    await expect(
      verifyDpopProof(proof, { htm: "POST", htu: HTU, expectedJkt: b.jkt })
    ).rejects.toBeInstanceOf(DpopError);
  });

  it("rejects a proof missing the dpop+jwt typ", async () => {
    const { privateKey, publicJwk } = await keypair();
    const proof = await makeProof(privateKey, publicJwk as JWK, { htm: "POST", htu: HTU }, { typ: "jwt" });
    await expect(verifyDpopProof(proof, { htm: "POST", htu: HTU })).rejects.toBeInstanceOf(DpopError);
  });
});
