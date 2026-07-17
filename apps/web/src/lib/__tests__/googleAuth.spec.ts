// ---------------------------------------------------------------------------
// Google Sign-In matrix. Drives the REAL POST /api/auth/google handler and the
// REAL lib/auth/google.ts verifier in mock mode (no GOOGLE_CLIENT_ID, NODE_ENV
// != production), which decodes the id_token WITHOUT signature verification —
// the documented dev path. This lets us exercise account creation/reuse, the
// verified-email linking policy, and the unverified-email rejection with forged
// tokens.
//
// What mock mode CANNOT cover: JWKS signature verification and audience (`aud`)
// checking — those are delegated to google-auth-library in live mode and need
// real Google keys. Marked BLOCKED (automated) in the report; the code path is
// correct and the library owns it.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as googlePOST } from "@/app/api/auth/google/route";
import { findUserByIdentity, listAccounts, getAccount } from "@/lib/store";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { verifySession } from "@/lib/session";

/** Forge an UNSIGNED Google id_token (mock verifier decodes without checking). */
function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.`;
}

function req(credential: unknown, mobile = true) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.2.0.${Math.floor(Math.random() * 250)}`,
  };
  if (mobile) headers["x-furlpay-client"] = "mobile-android/2.1.0";
  return new NextRequest("https://furlpay.com/api/auth/google", {
    method: "POST",
    headers,
    body: JSON.stringify({ credential }),
  });
}

const googleUser = (over: Record<string, unknown> = {}) => ({
  sub: `g-${crypto.randomUUID()}`,
  email: `g-${crypto.randomUUID()}@gmail.com`,
  email_verified: true,
  name: "Test Google User",
  ...over,
});

beforeEach(() => {
  delete process.env.GOOGLE_CLIENT_ID; // force mock verifier
  delete process.env.INTEGRATION_MODE;
});

describe("POST /api/auth/google — new user", () => {
  it("creates EXACTLY ONE account and issues a session scoped to it", async () => {
    const u = googleUser();
    const res = await googlePOST(req(idToken(u)));
    expect(res.status).toBe(200);

    const account = findUserByIdentity({ googleSub: u.sub });
    expect(account).toBeDefined();
    expect(listAccounts().filter((a) => a.user.googleSub === u.sub)).toHaveLength(1);

    const body = await res.json();
    const claims = await verifySession(body.token);
    expect(claims?.sub).toBe(account!.user.id);
  });
});

describe("POST /api/auth/google — existing user", () => {
  it("reuses the same account on a second sign-in — no duplicate", async () => {
    const u = googleUser();
    await googlePOST(req(idToken(u)));
    const firstId = findUserByIdentity({ googleSub: u.sub })!.user.id;

    await googlePOST(req(idToken(u)));
    expect(findUserByIdentity({ googleSub: u.sub })!.user.id).toBe(firstId);
    expect(listAccounts().filter((a) => a.user.googleSub === u.sub)).toHaveLength(1);
  });

  it("does not duplicate on concurrent identical sign-ins", async () => {
    const u = googleUser();
    await Promise.all([googlePOST(req(idToken(u))), googlePOST(req(idToken(u)))]);
    expect(listAccounts().filter((a) => a.user.googleSub === u.sub)).toHaveLength(1);
  });
});

describe("POST /api/auth/google — cross-auth linking policy", () => {
  it("links to an existing account when the VERIFIED email matches (googleSub attached)", async () => {
    // Seed an account as if it came from another provider, keyed by email.
    const shared = `link-${crypto.randomUUID()}@gmail.com`;
    const { findOrCreateUserByIdentity } = await import("@/lib/store");
    const seeded = findOrCreateUserByIdentity({ email: shared, name: "Email User" }).account;

    const u = googleUser({ email: shared, email_verified: true });
    const res = await googlePOST(req(idToken(u)));
    expect(res.status).toBe(200);

    // Same canonical account, now carrying the googleSub — no second account.
    const linked = findUserByIdentity({ googleSub: u.sub });
    expect(linked?.user.id).toBe(seeded.user.id);
    expect(listAccounts().filter((a) => a.user.email?.toLowerCase() === shared)).toHaveLength(1);
  });

  it("REJECTS an unverified Google email — never links/creates on an unproven identifier", async () => {
    const shared = `victim-${crypto.randomUUID()}@gmail.com`;
    const { findOrCreateUserByIdentity } = await import("@/lib/store");
    const victim = findOrCreateUserByIdentity({ email: shared, name: "Victim" }).account;

    // Attacker presents a Google token with the victim's email, unverified.
    const attacker = googleUser({ email: shared, email_verified: false });
    const res = await googlePOST(req(idToken(attacker)));
    expect(res.status).toBe(403);

    // Victim account untouched; no googleSub attached; no new account.
    expect(getAccount(victim.user.id)!.user.googleSub).toBeUndefined();
    expect(findUserByIdentity({ googleSub: attacker.sub })).toBeUndefined();
    expect(listAccounts().filter((a) => a.user.email?.toLowerCase() === shared)).toHaveLength(1);
  });
});

describe("POST /api/auth/google — malformed input", () => {
  it("400s a missing credential", async () => {
    const res = await googlePOST(req(undefined));
    expect(res.status).toBe(400);
  });

  it("401s a token with no sub/email", async () => {
    const res = await googlePOST(req(idToken({ foo: "bar" })));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/google — deleted account re-registration", () => {
  it("a deleted user signing in again gets a fresh account (documented policy)", async () => {
    const u = googleUser();
    await googlePOST(req(idToken(u)));
    const firstId = findUserByIdentity({ googleSub: u.sub })!.user.id;

    await deleteUserAccount(firstId);
    expect(getAccount(firstId)).toBeUndefined();

    // Re-registration: a NEW account, new id, working session — deletion is not
    // a permanent ban.
    const res = await googlePOST(req(idToken(u)));
    expect(res.status).toBe(200);
    const newAccount = findUserByIdentity({ googleSub: u.sub });
    expect(newAccount).toBeDefined();
    expect(newAccount!.user.id).not.toBe(firstId);
    const claims = await verifySession((await res.json()).token);
    expect(claims?.sub).toBe(newAccount!.user.id);
  });
});
