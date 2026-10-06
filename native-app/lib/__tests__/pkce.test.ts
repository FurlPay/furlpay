import fs from "fs";
import path from "path";
import nodeCrypto from "crypto";

// expo-crypto is native; back it with node's CSPRNG and SHA-256 so the real
// lib/pkce.ts logic runs unmodified.
jest.mock("expo-crypto", () => {
  const c = jest.requireActual("crypto") as typeof import("crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64", HEX: "hex" },
    getRandomBytes: (n: number) => new Uint8Array(c.randomBytes(n)),
    digestStringAsync: async (_alg: string, data: string, opts?: { encoding?: string }) =>
      c.createHash("sha256").update(data, "utf8").digest(opts?.encoding === "base64" ? "base64" : "hex"),
  };
});

import { base64ToBase64Url, base64UrlEncode, createPkcePair } from "../pkce";

// Audit P1-2: the Apple handoff code is PKCE-bound. The server computes
// base64url(SHA-256(ascii verifier)) (apps/web/src/lib/nativeSession.ts) — the
// app must produce exactly that, or every Apple sign-in fails closed.

describe("base64url", () => {
  it.each([0, 1, 2, 3, 31, 32, 33])("matches Node's base64url for %i bytes", (n) => {
    const bytes = new Uint8Array(nodeCrypto.randomBytes(n));
    expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
  });

  it("converts padded base64 to unpadded base64url", () => {
    expect(base64ToBase64Url("ab+/cd==")).toBe("ab-_cd");
  });
});

describe("createPkcePair", () => {
  it("verifier is RFC 7636 shaped (43 chars from 32 CSPRNG bytes)", async () => {
    const { verifier } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(verifier).toHaveLength(43);
  });

  it("challenge is exactly what the server computes from the verifier", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(challenge).toBe(nodeCrypto.createHash("sha256").update(verifier, "ascii").digest("base64url"));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is fresh per sign-in attempt", async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("signInWithApple wiring", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "oauth.ts"), "utf8");

  it("binds state and nonce to the challenge", () => {
    expect(src).toMatch(/const state = `\$\{Crypto\.randomUUID\(\)\}\.\$\{challenge\}`/);
    expect(src).toMatch(/const nonce = challenge;/);
  });

  it("sends the verifier at exchange, never the code alone", () => {
    expect(src).toMatch(/body: \{ code, code_verifier: codeVerifier \}/);
    expect(src).toMatch(/exchangeNativeCode\(handoff, verifier\)/);
  });
});
