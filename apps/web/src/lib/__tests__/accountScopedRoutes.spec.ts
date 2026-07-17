// Regression: these routes used to be UNAUTHENTICATED and operate on the seeded
// demo account (`db`). They now require a session and act on the caller. This
// pins that so the class of "demo-account instead of caller" bug can't return.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { GET as mfaGET, POST as mfaPOST } from "@/app/api/security/mfa/route";
import { POST as credentialPOST } from "@/app/api/compliance/credential/route";
import { GET as tierGET } from "@/app/api/compliance/tier/route";
import { GET as walletsGET } from "@/app/api/wallets/route";

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `scoped-${randomUUID()}@furlpay.test`,
    name: "Scoped User",
  });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { account, token };
}

function req(path: string, token: string | undefined, method: "GET" | "POST", body?: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.6.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("security/mfa requires auth and is per-user", () => {
  it("401s unauthenticated GET and POST", async () => {
    expect((await mfaGET(req("/security/mfa", undefined, "GET"))).status).toBe(401);
    expect((await mfaPOST(req("/security/mfa", undefined, "POST", { action: "enroll" }))).status).toBe(401);
  });

  it("enrolls TOTP on the CALLER's account (not the demo account)", async () => {
    const a = await actor();
    const res = await mfaPOST(req("/security/mfa", a.token, "POST", { action: "enroll" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe("string");
    // The secret was written to the caller's own account.
    expect(a.account.user.security.totpSecret).toBe(body.secret);
    expect(a.account.user.security.totpEnabled).toBe(false);

    // GET never returns the secret.
    const get = await mfaGET(req("/security/mfa", a.token, "GET"));
    expect(JSON.stringify(await get.json())).not.toContain(body.secret);
  });
});

describe("compliance/credential requires auth", () => {
  it("401s an unauthenticated issue attempt (no anonymous signed KYC credential)", async () => {
    const res = await credentialPOST(req("/compliance/credential", undefined, "POST", { action: "issue" }));
    expect(res.status).toBe(401);
  });

  it("403s a caller who is not KYC-verified", async () => {
    const a = await actor(); // fresh account: kycStatus is not 'verified'
    const res = await credentialPOST(req("/compliance/credential", a.token, "POST", { action: "issue" }));
    expect(res.status).toBe(403);
  });

  it("issues a credential bound to the caller with SERVER-derived attributes (client cannot override)", async () => {
    const a = await actor();
    // Simulate a genuinely verified account (setKycStatus is webhook-only; set
    // directly for the test).
    a.account.user.kycStatus = "verified";
    a.account.user.kycTier = 2;

    // Attempt to override the trusted attributes via the body — must be ignored.
    const res = await credentialPOST(
      req("/compliance/credential", a.token, "POST", {
        action: "issue",
        ageOver18: false,
        sanctionsClear: false,
        tier: 3,
        jurisdiction: "XX",
        subject: "someone-else",
      })
    );
    expect(res.status).toBe(200);
    const { credential } = await res.json();
    // The credential is bound to the caller and carries the server's attributes,
    // never the client-supplied overrides.
    expect(credential.subject ?? credential.userId ?? credential.sub).toBe(a.account.user.id);
    const attrs = credential.attributes ?? credential;
    expect(attrs.ageOver18).toBe(true);
    expect(attrs.sanctionsClear).toBe(true);
    expect(attrs.tier).toBe(2); // the account's real tier, not the body's 3
  });
});

describe("compliance/tier and wallets are per-user and require auth", () => {
  it("401s unauthenticated", async () => {
    expect((await tierGET(req("/compliance/tier", undefined, "GET"))).status).toBe(401);
    expect((await walletsGET(req("/wallets", undefined, "GET"))).status).toBe(401);
  });

  it("returns the caller's own tier + safeAddress", async () => {
    const a = await actor();
    const tier = await tierGET(req("/compliance/tier", a.token, "GET"));
    expect((await tier.json()).currentTier).toBe(a.account.user.kycTier);

    const wallets = await walletsGET(req("/wallets", a.token, "GET"));
    expect((await wallets.json()).safeAddress).toBe(a.account.user.safeAddress);
  });
});
