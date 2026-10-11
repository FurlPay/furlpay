import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueCredential } from "@furlpay/compliance";

/*
 * Production signed and verified KYC credentials with a key printed in the
 * repository, so anyone could mint a "verified, sanctions clear" credential
 * that this route then accepted. These tests pin the fix.
 */

vi.mock("@/lib/authz", () => ({
  requireUser: async () => ({ ok: true, account: { user: { id: "u1", kycStatus: "verified", region: "EU", kycTier: 2 } }, claims: {} }),
}));

const { credentialSecret } = await import("@/lib/compliance/credentialSecret");
const { POST } = await import("@/app/api/compliance/credential/route");
const PUBLIC_KEY_IN_REPO = "furlpay_credential_issuer_sandbox";
const REAL = "a-real-credential-secret-of-at-least-32-chars";

const call = (body: unknown) =>
  POST(new NextRequest("https://furlpay.test/api/compliance/credential", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("credentialSecret", () => {
  it("refuses in production when no secret is configured", () => {
    expect(credentialSecret({ NODE_ENV: "production" })).toBeNull();
  });

  it("refuses in production when the configured secret is the public development one, or too short", () => {
    expect(credentialSecret({ NODE_ENV: "production", FURLPAY_CREDENTIAL_SECRET: PUBLIC_KEY_IN_REPO })).toBeNull();
    expect(credentialSecret({ NODE_ENV: "production", FURLPAY_CREDENTIAL_SECRET: "short" })).toBeNull();
  });

  it("uses a real configured secret anywhere", () => {
    expect(credentialSecret({ NODE_ENV: "production", FURLPAY_CREDENTIAL_SECRET: REAL })).toBe(REAL);
    expect(credentialSecret({ NODE_ENV: "development", FURLPAY_CREDENTIAL_SECRET: REAL })).toBe(REAL);
  });

  it("keeps the development fallback outside production builds", () => {
    expect(credentialSecret({ NODE_ENV: "development" })).toBe(PUBLIC_KEY_IN_REPO);
    expect(credentialSecret({ NODE_ENV: "test" })).toBe(PUBLIC_KEY_IN_REPO);
  });
});

describe("POST /api/compliance/credential in production", () => {
  it("answers 503 instead of signing with the public key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_CREDENTIAL_SECRET", "");
    try {
      expect((await call({ action: "issue" })).status).toBe(503);
      // A credential forged with the in-repo key is not checked, let alone accepted.
      const forged = issueCredential("attacker", { ageOver18: true, jurisdiction: "EU", sanctionsClear: true, tier: 3 }, PUBLIC_KEY_IN_REPO);
      const res = await call({ action: "verify", credential: forged });
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a credential forged with the public key once a real secret is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_CREDENTIAL_SECRET", REAL);
    try {
      const forged = issueCredential("attacker", { ageOver18: true, jurisdiction: "EU", sanctionsClear: true, tier: 3 }, PUBLIC_KEY_IN_REPO);
      const body = await (await call({ action: "verify", credential: forged })).json();
      expect(body.check.valid).toBe(false);
      expect(body.attributes).toBeNull();

      const issued = await (await call({ action: "issue" })).json();
      const ok = await (await call({ action: "verify", credential: issued.credential })).json();
      expect(ok.check.valid).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("validates the body", async () => {
    expect((await call({ action: "other" })).status).toBe(400);
    expect((await call({ action: "verify" })).status).toBe(400);
  });
});
