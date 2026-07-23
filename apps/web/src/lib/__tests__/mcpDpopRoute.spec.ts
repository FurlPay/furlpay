// DPoP at the TRANSPORT layer — drives the REAL /api/mcp route.
//
// mcpDpop.spec.ts covers verifyDpopProof() in isolation and passed while the
// feature was unusable end to end: the route parsed only `Authorization:
// Bearer`, but /api/oauth/token returns `token_type: "DPoP"` for bound grants,
// so every spec-compliant client sent `Authorization: DPoP …` and got a 401
// advising a downgrade it could not perform. Unit tests on the verifier cannot
// see that. These tests send real HTTP-shaped requests instead.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from "jose";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { issueAccessToken } from "@/lib/mcp/oauth";
import { accessTokenHash } from "@/lib/mcp/dpop";
import { findOrCreateUserByIdentity } from "@/lib/store";

const HTU = "https://furlpay.com/api/mcp";

async function keypair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const jkt = await calculateJwkThumbprint(publicJwk, "sha256");
  return { privateKey, publicJwk, jkt };
}

/** A connector token bound to a fresh key, plus everything needed to prove it. */
async function boundActor() {
  const email = `mcp-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "MCP Client" });
  const { privateKey, publicJwk, jkt } = await keypair();
  const token = await issueAccessToken(account.user.id, [], account.user.safeAddress, jkt);
  return { token, privateKey, publicJwk, jkt };
}

async function unboundActor() {
  const email = `mcp-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "MCP Client" });
  const token = await issueAccessToken(account.user.id, [], account.user.safeAddress);
  return { token };
}

async function proofFor(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  publicJwk: JWK,
  token: string
) {
  return new SignJWT({ htm: "POST", htu: HTU, ath: accessTokenHash(token) })
    .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk })
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(privateKey);
}

function req(authorization?: string, dpop?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
  };
  if (authorization) headers.authorization = authorization;
  if (dpop) headers.dpop = dpop;
  return new NextRequest(HTU, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
}

const challenge = (res: Response) => res.headers.get("WWW-Authenticate") ?? "";

describe("/api/mcp — DPoP transport binding (RFC 9449 §7.1)", () => {
  it("accepts a bound token under the DPoP scheme with a valid proof", async () => {
    const a = await boundActor();
    const proof = await proofFor(a.privateKey, a.publicJwk, a.token);
    const res = await mcpPOST(req(`DPoP ${a.token}`, proof));
    // The regression: this was an unconditional 401 before the scheme fix.
    expect(res.status).not.toBe(401);
  });

  it("treats the scheme name case-insensitively (RFC 9110 §11.1)", async () => {
    const a = await boundActor();
    const proof = await proofFor(a.privateKey, a.publicJwk, a.token);
    const res = await mcpPOST(req(`dpop ${a.token}`, proof));
    expect(res.status).not.toBe(401);
  });

  it("rejects a bound token downgraded to the Bearer scheme, even with a proof", async () => {
    const a = await boundActor();
    const proof = await proofFor(a.privateKey, a.publicJwk, a.token);
    const res = await mcpPOST(req(`Bearer ${a.token}`, proof));
    expect(res.status).toBe(401);
    // Must advertise DPoP, not invite a downgrade the client cannot perform.
    expect(challenge(res)).toMatch(/^DPoP /);
  });

  it("rejects a bound token presented with no proof at all", async () => {
    const a = await boundActor();
    const res = await mcpPOST(req(`DPoP ${a.token}`));
    expect(res.status).toBe(401);
    expect(challenge(res)).toMatch(/^DPoP /);
  });

  it("rejects a proof signed by a key other than the one the token is bound to", async () => {
    const a = await boundActor();
    const attacker = await keypair();
    // Stolen token, attacker's own key — the cnf.jkt inside the signed token
    // cannot be edited, so this is the realistic replay attempt.
    const proof = await proofFor(attacker.privateKey, attacker.publicJwk, a.token);
    const res = await mcpPOST(req(`DPoP ${a.token}`, proof));
    expect(res.status).toBe(401);
  });

  it("still accepts an unbound token under Bearer (rollout back-compat)", async () => {
    const a = await unboundActor();
    const res = await mcpPOST(req(`Bearer ${a.token}`));
    expect(res.status).not.toBe(401);
  });

  it("fails closed on an unbound token sent under the DPoP scheme", async () => {
    const a = await unboundActor();
    const res = await mcpPOST(req(`DPoP ${a.token}`));
    expect(res.status).toBe(401);
  });

  it("401s an unknown auth scheme and a bare token", async () => {
    const a = await unboundActor();
    expect((await mcpPOST(req(`Basic ${a.token}`))).status).toBe(401);
    expect((await mcpPOST(req(a.token))).status).toBe(401);
  });
});
