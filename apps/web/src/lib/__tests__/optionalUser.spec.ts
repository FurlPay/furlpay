import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { optionalUser } from "@/lib/authz";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";
import { deleteUserAccount } from "@/lib/accountDeletion";

// ---------------------------------------------------------------------------
// Regression tests for the verifySession() -> optionalUser() migration.
//
// Routes with a legitimate anonymous path (funding by account number,
// registering a demo agent key, reading a market quote) previously resolved the
// caller with a bare verifySession(cookie). That skipped four protections that
// requireUser() applies: the durable cross-instance revocation denylist, MCP
// connector scope enforcement, the deleted-account tombstone, and the account
// lock. A revoked session was indistinguishable from a live one.
//
// The distinction these tests pin down is between NO credential and a BAD
// credential. No credential is anonymous. A credential that is present but dead
// must be REJECTED — never silently downgraded to anonymous, which would let a
// caller who presented a revoked token be served as though they had presented
// nothing, on the very routes that credit and spend money.
// ---------------------------------------------------------------------------

async function actor() {
  const email = `opt-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Optional User" });
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { id: account.user.id, token };
}

function req(token?: string) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.11.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/account/fund", { method: "POST", headers });
}

describe("optionalUser — anonymous vs bad credential", () => {
  it("treats a request with NO credential as anonymous, not an error", () => {
    return optionalUser(req()).then((auth) => {
      expect(auth.kind).toBe("anonymous");
    });
  });

  it("resolves a live session to its account", async () => {
    const a = await actor();
    const auth = await optionalUser(req(a.token));
    expect(auth.kind).toBe("user");
    if (auth.kind === "user") expect(auth.account.user.id).toBe(a.id);
  });

  it("REJECTS a deleted account's still-valid token instead of serving it anonymously", async () => {
    const a = await actor();
    await deleteUserAccount(a.id);

    const auth = await optionalUser(req(a.token));
    // The critical assertion. Downgrading to "anonymous" here is what the old
    // verifySession() path effectively did on account/fund — the request
    // proceeded, just without an owner.
    expect(auth.kind).toBe("rejected");
    if (auth.kind === "rejected") expect(auth.res.status).toBe(401);
  });

  it("REJECTS a locked account rather than resolving it", async () => {
    const a = await actor();
    const account = getAccount(a.id);
    expect(account).toBeTruthy();
    account!.user.security.accountLocked = true;

    const auth = await optionalUser(req(a.token));
    expect(auth.kind).toBe("rejected");
    if (auth.kind === "rejected") expect(auth.res.status).toBe(423);
  });

  it("REJECTS a malformed or forged token rather than falling back to anonymous", async () => {
    const auth = await optionalUser(req("not-a-real-jwt"));
    expect(auth.kind).toBe("rejected");
    if (auth.kind === "rejected") expect(auth.res.status).toBe(401);
  });

  it("never returns an account for a rejected credential", async () => {
    const a = await actor();
    await deleteUserAccount(a.id);
    const auth = await optionalUser(req(a.token));
    expect("account" in auth).toBe(false);
  });
});
