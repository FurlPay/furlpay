// ---------------------------------------------------------------------------
// Passkey credential -> user binding.
//
// THE BUG THIS SUITE EXISTS FOR
// =============================
// Credentials were stored only as `webauthn:creds:<userId>`, with no way back
// from a credential id to its owner. So every passkey route resolved the user
// as `db.user` -- the shared seeded demo account. Registration filed every
// credential under that one account, and authentication issued a session for
// it no matter which passkey was presented.
//
// A WebAuthn assertion identifies a CREDENTIAL, not a person. Turning one into
// the other is the relying party's job, and these tests pin that it is now
// actually done.
//
// WHAT IS MOCKED, AND WHY
// =======================
// @simplewebauthn/server's verify* functions are mocked. They own the
// cryptography -- signature, challenge and origin checking -- and re-testing
// them here would test the library, not us. What is NOT mocked is everything
// this codebase is responsible for: which user a credential belongs to, which
// user's public key is verified against, and whose session comes out. That is
// precisely where the defect was.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.hoisted, because vi.mock is lifted above every `const` in the file and
// a plain top-level mock fn would be in its temporal dead zone when the
// factory runs.
const mocks = vi.hoisted(() => ({
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: "test-challenge-" + Math.random().toString(36).slice(2),
    rpId: "localhost",
    userVerification: "required",
  })),
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: "reg-challenge-" + Math.random().toString(36).slice(2),
  })),
}));

vi.mock("@simplewebauthn/server", () => mocks);

const {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = mocks;

import { NextRequest } from "next/server";
import {
  claimCredentialOwner,
  getCredentialOwner,
  clearCredentialOwner,
  addCredential,
  getCredentials,
  removeCredential,
  updateCounter,
  putCeremonyChallenge,
  consumeCeremonyChallenge,
} from "@/lib/webauthn";
import { POST as authPOST, GET as authGET } from "@/app/api/auth/passkey/authenticate/route";
import { POST as regPOST, GET as regGET } from "@/app/api/auth/passkey/register/route";
import { verifySession, signSession } from "@/lib/session";
import { db, getAccount, findOrCreateUserByIdentityDurable } from "@/lib/store";

let n = 0;
const ip = () => `10.77.0.${(n += 1) % 250}`;

function assertionReq(credId: string, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip(),
    "x-furlpay-client": "mobile-ios/2.1.0",
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/auth/passkey/authenticate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: credId,
      rawId: credId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "Y2xpZW50RGF0YQ",
        authenticatorData: "YXV0aERhdGE",
        signature: "c2ln",
      },
    }),
  });
}

function registerReq(credId: string, token?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip(),
    "x-furlpay-client": "mobile-ios/2.1.0",
  };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/auth/passkey/register", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: credId,
      rawId: credId,
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: "Y2xpZW50RGF0YQ", attestationObject: "YXR0" },
    }),
  });
}

const key = (seed: number) => new Uint8Array([1, 2, 3, seed]);

/** A real, distinct user account (not the demo one). */
async function makeUser(tag: string) {
  const { account } = await findOrCreateUserByIdentityDurable({
    phone: `+1555000${(n += 1).toString().padStart(4, "0")}`,
    name: tag,
    authProvider: "phone",
  });
  return account.user;
}

beforeEach(() => {
  verifyAuthenticationResponse.mockReset();
  verifyRegistrationResponse.mockReset();
});

/* ------------------------- the ownership index ---------------------------- */

describe("credential ownership index", () => {
  it("maps a credential id to its owner", async () => {
    const ok = await claimCredentialOwner("cred-map-1", "user-A");
    expect(ok).toBe(true);
    expect(await getCredentialOwner("cred-map-1")).toBe("user-A");
  });

  it("refuses to repoint a claimed credential at another user", async () => {
    expect(await claimCredentialOwner("cred-dup-1", "user-A")).toBe(true);
    // The whole point: a second claim must NOT silently rebind.
    expect(await claimCredentialOwner("cred-dup-1", "user-B")).toBe(false);
    expect(await getCredentialOwner("cred-dup-1")).toBe("user-A");
  });

  it("returns undefined for an unknown credential", async () => {
    expect(await getCredentialOwner("cred-never-seen")).toBeUndefined();
  });

  it("frees the id when the credential is removed, so it can be re-registered", async () => {
    await claimCredentialOwner("cred-free-1", "user-A");
    await addCredential("user-A", { id: "cred-free-1", publicKey: key(1), counter: 0 });
    expect(await removeCredential("user-A", "cred-free-1")).toBe(true);
    expect(await getCredentialOwner("cred-free-1")).toBeUndefined();
    expect(await claimCredentialOwner("cred-free-1", "user-B")).toBe(true);
  });

  it("keeps two users' credentials separate", async () => {
    await claimCredentialOwner("cred-a", "user-A");
    await claimCredentialOwner("cred-b", "user-B");
    expect(await getCredentialOwner("cred-a")).toBe("user-A");
    expect(await getCredentialOwner("cred-b")).toBe("user-B");
  });

  it("supports multiple credentials for one user", async () => {
    await claimCredentialOwner("cred-multi-1", "user-M");
    await claimCredentialOwner("cred-multi-2", "user-M");
    await addCredential("user-M", { id: "cred-multi-1", publicKey: key(1), counter: 0 });
    await addCredential("user-M", { id: "cred-multi-2", publicKey: key(2), counter: 0 });
    const list = await getCredentials("user-M");
    expect(list.map((c) => c.id).sort()).toEqual(["cred-multi-1", "cred-multi-2"]);
    expect(await getCredentialOwner("cred-multi-1")).toBe("user-M");
    expect(await getCredentialOwner("cred-multi-2")).toBe("user-M");
  });
});

/* --------------------------- ceremony challenges --------------------------- */

describe("ceremony challenge", () => {
  it("is single-use — a replayed challenge is rejected", async () => {
    await putCeremonyChallenge("chal-once");
    expect(await consumeCeremonyChallenge("chal-once")).toBe(true);
    expect(await consumeCeremonyChallenge("chal-once")).toBe(false);
  });

  it("rejects a challenge that was never issued", async () => {
    expect(await consumeCeremonyChallenge("chal-forged")).toBe(false);
  });

  it("options do not name a user and do not pin allowCredentials", async () => {
    const res = await authGET(
      new NextRequest("https://furlpay.com/api/auth/passkey/authenticate", {
        headers: { "x-forwarded-for": ip() },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // Usernameless: listing a user's credentials here is what leaked the
    // shared demo identity into the ceremony.
    expect(json.allowCredentials).toBeUndefined();
    expect(json.challenge).toBeTruthy();
  });
});

/* --------------------------- authentication ------------------------------- */

describe("passkey authentication resolves the credential's owner", () => {
  it("a credential owned by A issues a session for A — not the demo account", async () => {
    const a = await makeUser("User A");
    await claimCredentialOwner("cred-A", a.id);
    await addCredential(a.id, { id: "cred-A", publicKey: key(1), counter: 0 });

    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const res = await authPOST(assertionReq("cred-A"));
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const claims = await verifySession(token);

    expect(claims?.sub).toBe(a.id);
    expect(claims?.sub).not.toBe(db.user.id); // the demo account
  });

  it("verifies against the OWNER's public key, never another user's", async () => {
    const a = await makeUser("Owner A");
    const b = await makeUser("Other B");
    await claimCredentialOwner("cred-owner-key", a.id);
    await addCredential(a.id, { id: "cred-owner-key", publicKey: key(7), counter: 0 });
    await addCredential(b.id, { id: "cred-other", publicKey: key(9), counter: 0 });

    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    await authPOST(assertionReq("cred-owner-key"));

    const passed = verifyAuthenticationResponse.mock.calls[0][0];
    expect(passed.credential.id).toBe("cred-owner-key");
    expect(Array.from(passed.credential.publicKey as Uint8Array)).toEqual(Array.from(key(7)));
  });

  it("a credential cannot be used to sign in as a different user", async () => {
    const a = await makeUser("A2");
    const b = await makeUser("B2");
    await claimCredentialOwner("cred-A2", a.id);
    await addCredential(a.id, { id: "cred-A2", publicKey: key(1), counter: 0 });

    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const res = await authPOST(assertionReq("cred-A2"));
    const { token } = await res.json();
    const claims = await verifySession(token);
    expect(claims?.sub).toBe(a.id);
    expect(claims?.sub).not.toBe(b.id);
  });

  it("an unknown credential is rejected with a generic 401", async () => {
    const res = await authPOST(assertionReq("cred-does-not-exist"));
    expect(res.status).toBe(401);
    const json = await res.json();
    // Generic on purpose: distinguishing "no such credential" from "no such
    // owner" would let a caller enumerate credential ids.
    expect(json.error).toBe("Unknown credential");
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("a credential whose owner no longer exists is rejected, not defaulted", async () => {
    await claimCredentialOwner("cred-orphan", "user-that-never-existed");
    const res = await authPOST(assertionReq("cred-orphan"));
    expect(res.status).toBe(401);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("a failed assertion issues no session", async () => {
    const a = await makeUser("A3");
    await claimCredentialOwner("cred-A3", a.id);
    await addCredential(a.id, { id: "cred-A3", publicKey: key(1), counter: 0 });
    verifyAuthenticationResponse.mockResolvedValue({ verified: false });

    const res = await authPOST(assertionReq("cred-A3"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.token).toBeUndefined();
  });

  it("still advances the signature counter (clone detection intact)", async () => {
    const a = await makeUser("A4");
    await claimCredentialOwner("cred-A4", a.id);
    await addCredential(a.id, { id: "cred-A4", publicKey: key(1), counter: 5 });

    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    await authPOST(assertionReq("cred-A4"));

    const [cred] = (await getCredentials(a.id)).filter((c) => c.id === "cred-A4");
    expect(cred.counter).toBe(6);
    expect(cred.lastUsedAt).toBeTruthy();

    // The stored counter is what the library is given on the next attempt --
    // that is the input clone detection depends on.
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });
    await authPOST(assertionReq("cred-A4"));
    expect(verifyAuthenticationResponse.mock.calls[1][0].credential.counter).toBe(6);
  });
});

/* ---------------------------- registration -------------------------------- */

describe("passkey registration binds to the signed-in account", () => {
  it("refuses an unauthenticated enrolment instead of using the demo account", async () => {
    const getRes = await regGET(
      new NextRequest("https://furlpay.com/api/auth/passkey/register", {
        headers: { "x-forwarded-for": ip() },
      })
    );
    expect(getRes.status).toBe(401);

    const postRes = await regPOST(registerReq("cred-anon"));
    expect(postRes.status).toBe(401);
    // The decisive assertion: nothing was filed against the demo account.
    expect(await getCredentialOwner("cred-anon")).toBeUndefined();
  });

  it("enrols onto the authenticated user and claims ownership", async () => {
    const u = await makeUser("Enroller");
    const token = await signSession({ sub: u.id, safe: u.safeAddress, roles: u.roles });

    // Seed the registration challenge the route will consume.
    await regGET(
      new NextRequest("https://furlpay.com/api/auth/passkey/register", {
        headers: { "x-forwarded-for": ip(), authorization: `Bearer ${token}` },
      })
    );

    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: "cred-enrolled", publicKey: key(3), counter: 0 } },
    });

    const res = await regPOST(registerReq("cred-enrolled", token));
    expect(res.status).toBe(200);
    expect(await getCredentialOwner("cred-enrolled")).toBe(u.id);
    expect(await getCredentialOwner("cred-enrolled")).not.toBe(db.user.id);
  });

  it("rejects enrolling a credential that already belongs to someone else", async () => {
    const owner = await makeUser("First owner");
    const thief = await makeUser("Second claimant");
    await claimCredentialOwner("cred-contested", owner.id);

    const token = await signSession({ sub: thief.id, safe: thief.safeAddress, roles: thief.roles });
    await regGET(
      new NextRequest("https://furlpay.com/api/auth/passkey/register", {
        headers: { "x-forwarded-for": ip(), authorization: `Bearer ${token}` },
      })
    );
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { credential: { id: "cred-contested", publicKey: key(4), counter: 0 } },
    });

    const res = await regPOST(registerReq("cred-contested", token));
    expect(res.status).toBe(409);
    // Ownership is unchanged — the contested claim did not take.
    expect(await getCredentialOwner("cred-contested")).toBe(owner.id);
  });

  it("supports a second passkey on the same account (multi-device)", async () => {
    const u = await makeUser("Two devices");
    const token = await signSession({ sub: u.id, safe: u.safeAddress, roles: u.roles });

    for (const id of ["cred-dev-1", "cred-dev-2"]) {
      await regGET(
        new NextRequest("https://furlpay.com/api/auth/passkey/register", {
          headers: { "x-forwarded-for": ip(), authorization: `Bearer ${token}` },
        })
      );
      verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: { credential: { id, publicKey: key(5), counter: 0 } },
      });
      const res = await regPOST(registerReq(id, token));
      expect(res.status).toBe(200);
    }

    const list = await getCredentials(u.id);
    expect(list.map((c) => c.id)).toEqual(expect.arrayContaining(["cred-dev-1", "cred-dev-2"]));
    expect(await getCredentialOwner("cred-dev-1")).toBe(u.id);
    expect(await getCredentialOwner("cred-dev-2")).toBe(u.id);
  });
});
