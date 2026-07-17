// ---------------------------------------------------------------------------
// Account-deletion matrix. Drives the REAL DELETE /api/account handler and the
// REAL lib/accountDeletion.ts — nothing about the deletion path is mocked. The
// store runs on its in-memory backend (supabaseBackend="none", no credentials
// in CI), which is a first-class supported backend of this codebase.
//
// What this suite CANNOT prove: the Postgres cascade / set-null / no-FK split
// that implements the retention model. That is enforced by the schema, so it is
// asserted two other ways:
//   - accountRetentionSchema.spec.ts — the migrations still declare it;
//   - scripts/db/account-deletion-retention.mjs — executes it against a real
//     Postgres (CI/staging; refuses to run without DATABASE_URL).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { DELETE as accountDELETE, GET as accountGET } from "@/app/api/account/route";
import { signSession } from "@/lib/session";
import { recordStepUp } from "@/lib/stepup";
import { kvGet, kvSet } from "@/lib/kv";
import { auditEntries } from "@/lib/audit";
import {
  DEMO_USER_ID,
  findOrCreateUserByIdentity,
  findUserByIdentity,
  getAccount,
  evictAccount,
} from "@/lib/store";
import { deleteUserAccount, isAccountDeleted } from "@/lib/accountDeletion";
import { registerOwnedAgentKey, getAgentKey } from "@/lib/agentPolicy";

interface Actor {
  userId: string;
  email: string;
  token: string;
  jti: string;
}

/** A real, non-demo account with a real signed session. */
async function actor(): Promise<Actor> {
  const email = `del-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Deletion Subject" });
  const jti = randomUUID();
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti });
  return { userId: account.user.id, email, token, jti };
}

/** Each test gets its own client IP so the (deliberately tight) 5/hour delete
 *  budget in one test cannot 429 the next one. */
function req(
  method: "GET" | "DELETE",
  opts: { token?: string; ip?: string; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new NextRequest("https://furlpay.com/api/account", {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("DELETE /api/account — authorization", () => {
  it("401s an unauthenticated request", async () => {
    const res = await accountDELETE(req("DELETE"));
    expect(res.status).toBe(401);
  });

  it("403s without a recent step-up — a bare stolen session cannot erase an account", async () => {
    const a = await actor();
    const res = await accountDELETE(req("DELETE", { token: a.token }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("stepup_required");
    // And the account is untouched.
    expect(getAccount(a.userId)).toBeDefined();
    expect(await isAccountDeleted(a.userId)).toBe(false);
  });

  it("403s a guest session — guests share the seeded demo account", async () => {
    const jti = randomUUID();
    const token = await signSession({
      sub: DEMO_USER_ID,
      safe: "0x0",
      roles: ["user"],
      jti,
      guest: true,
    });
    await recordStepUp(DEMO_USER_ID, jti, "otp"); // even WITH step-up
    const res = await accountDELETE(req("DELETE", { token }));
    expect(res.status).toBe(403);
    expect(getAccount(DEMO_USER_ID)).toBeDefined(); // demo account survives
  });

  it("refuses to delete the demo account even at the library level", async () => {
    await expect(deleteUserAccount(DEMO_USER_ID)).rejects.toThrow(/demo account/i);
    expect(getAccount(DEMO_USER_ID)).toBeDefined();
    expect(evictAccount(DEMO_USER_ID)).toBe(false);
  });

  it("rate-limits repeated attempts from one IP", async () => {
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a = await actor(); // fresh session each time; same IP
      statuses.push((await accountDELETE(req("DELETE", { token: a.token, ip }))).status);
    }
    // Budget is 5/hour: the first five get as far as the step-up check (403),
    // then the limiter takes over.
    expect(statuses.slice(0, 5).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe("DELETE /api/account — IDOR", () => {
  it("ignores a user id supplied in the body and deletes only the caller", async () => {
    const attacker = await actor();
    const victim = await actor();
    await recordStepUp(attacker.userId, attacker.jti, "passkey");

    const res = await accountDELETE(
      req("DELETE", { token: attacker.token, body: { userId: victim.userId } })
    );
    expect(res.status).toBe(200);

    // The caller is gone; the victim named in the body is untouched.
    expect(await isAccountDeleted(attacker.userId)).toBe(true);
    expect(getAccount(attacker.userId)).toBeUndefined();
    expect(await isAccountDeleted(victim.userId)).toBe(false);
    expect(getAccount(victim.userId)).toBeDefined();
  });
});

describe("DELETE /api/account — successful erasure", () => {
  it("erases the account, reports the retention split, and clears the session cookie", async () => {
    const a = await actor();
    await recordStepUp(a.userId, a.jti, "otp");

    const res = await accountDELETE(req("DELETE", { token: a.token }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.erased.length).toBeGreaterThan(0);
    // Honest retention reporting: the response must NOT claim total erasure.
    expect(body.retained.length).toBeGreaterThan(0);
    expect(body.retained.map((r: { record: string }) => r.record).join(" ")).toMatch(/audit/i);

    // Session cookie is cleared on the response.
    expect(res.cookies.get("furlpay_session")?.value).toBe("");
  });

  it("removes personal data and the identity indexes", async () => {
    const a = await actor();
    await recordStepUp(a.userId, a.jti, "otp");
    expect(findUserByIdentity({ email: a.email })).toBeDefined();

    await accountDELETE(req("DELETE", { token: a.token }));

    expect(getAccount(a.userId)).toBeUndefined();
    // The email no longer resolves to the dead account — a re-signup with the
    // same address starts clean instead of resurrecting it.
    expect(findUserByIdentity({ email: a.email })).toBeUndefined();
  });

  it("revokes passkey credentials and push registrations", async () => {
    const a = await actor();
    await kvSet(`webauthn:creds:${a.userId}`, [{ id: "cred-1", publicKey: "x", counter: 0 }]);
    await kvSet(`push:fcm:${a.userId}`, [{ token: "fcm-token-1", addedAt: "now" }]);
    await kvSet(`push:subs:${a.userId}`, [{ endpoint: "https://push.example/1" }]);
    await recordStepUp(a.userId, a.jti, "otp");

    await accountDELETE(req("DELETE", { token: a.token }));

    expect(await kvGet(`webauthn:creds:${a.userId}`)).toBeNull();
    expect(await kvGet(`push:fcm:${a.userId}`)).toBeNull();
    expect(await kvGet(`push:subs:${a.userId}`)).toBeNull();
  });

  it("revokes agent/API keys", async () => {
    const a = await actor();
    // A REAL ed25519 public key — agent-trust fingerprints it, so a dummy
    // string would fail in the library rather than exercise the revocation.
    const { publicKey } = generateKeyPairSync("ed25519");
    const { keyId } = await registerOwnedAgentKey({
      userId: a.userId,
      name: "test-agent",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      policy: { dailyUsdCap: 10, perTxUsdCap: 5, allowedCategories: [] },
    });
    expect((await getAgentKey(keyId))?.status).toBe("active");

    await recordStepUp(a.userId, a.jti, "otp");
    await accountDELETE(req("DELETE", { token: a.token }));

    // The key record survives as evidence but can no longer authorize spend.
    expect((await getAgentKey(keyId))?.status).toBe("revoked");
    expect(await kvGet(`agent:index:${a.userId}`)).toBeNull();
  });

  it("writes an audit event that OUTLIVES the account it records", async () => {
    const a = await actor();
    await recordStepUp(a.userId, a.jti, "otp");
    await accountDELETE(req("DELETE", { token: a.token }));

    const entry = auditEntries(500).find(
      (e) => e.event === "account.deleted" && e.actor === a.userId
    );
    expect(entry).toBeDefined();
    // The account is gone, the evidence is not — the retention model in one
    // assertion.
    expect(getAccount(a.userId)).toBeUndefined();
    // And it carries no PII.
    expect(JSON.stringify(entry!.fields)).not.toContain(a.email);
  });
});

describe("DELETE /api/account — session revocation", () => {
  it("kills the session that performed the deletion", async () => {
    const a = await actor();
    await recordStepUp(a.userId, a.jti, "otp");
    await accountDELETE(req("DELETE", { token: a.token }));

    // revokeSession() already denied this exact jti — it never even reaches the
    // account lookup.
    expect((await accountGET(req("GET", { token: a.token }))).status).toBe(401);
  });

  it("kills OTHER live sessions of the deleted user — the tombstone, not revokeSession", async () => {
    // The real scenario: the user is signed in on a second device. That
    // session's jti was never revoked (revokeSession is per-jti AND
    // per-instance), so only the durable tombstone can stop it.
    const a = await actor();
    const otherJti = randomUUID();
    const otherDevice = await signSession({
      sub: a.userId,
      safe: "0x0",
      roles: ["user"],
      jti: otherJti,
    });
    expect((await accountGET(req("GET", { token: otherDevice }))).status).toBe(200);

    await recordStepUp(a.userId, a.jti, "otp");
    await accountDELETE(req("DELETE", { token: a.token }));

    const res = await accountGET(req("GET", { token: otherDevice }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Account deleted");
  });

  it("keeps rejecting even if a warm instance still holds an account copy", async () => {
    const a = await actor();
    const otherJti = randomUUID();
    const otherDevice = await signSession({
      sub: a.userId,
      safe: "0x0",
      roles: ["user"],
      jti: otherJti,
    });
    await recordStepUp(a.userId, a.jti, "otp");
    await accountDELETE(req("DELETE", { token: a.token }));

    // Simulate an instance whose in-memory map still resolves the user: the
    // tombstone is checked BEFORE the store lookup, so access stays denied.
    findOrCreateUserByIdentity({ email: a.email, name: "Resurrected" });
    expect((await accountGET(req("GET", { token: otherDevice }))).status).toBe(401);
  });
});

describe("DELETE /api/account — idempotency & partial failure", () => {
  it("is idempotent at the library level: a second erase reports deleted:false and does not throw", async () => {
    const a = await actor();
    const first = await deleteUserAccount(a.userId);
    expect(first.deleted).toBe(true);

    const second = await deleteUserAccount(a.userId);
    expect(second.deleted).toBe(false);
    expect(second.retained).toEqual(first.retained);
    expect(await isAccountDeleted(a.userId)).toBe(true);
  });

  it("a repeated HTTP delete fails closed (401) rather than re-running", async () => {
    const a = await actor();
    await recordStepUp(a.userId, a.jti, "otp");
    expect((await accountDELETE(req("DELETE", { token: a.token }))).status).toBe(200);
    expect((await accountDELETE(req("DELETE", { token: a.token }))).status).toBe(401);
  });

  it("completes (and tombstones) for a user with no in-memory account — a retried partial deletion", async () => {
    const orphan = randomUUID();
    const out = await deleteUserAccount(orphan);
    expect(out.deleted).toBe(true);
    // Access revocation is the FIRST step, so it holds even when there was
    // nothing left to erase.
    expect(await isAccountDeleted(orphan)).toBe(true);
  });
});

describe("GET /api/account — pre-confirmation disclosure", () => {
  it("tells the UI the retention model and whether step-up is satisfied", async () => {
    const a = await actor();
    const before = await (await accountGET(req("GET", { token: a.token }))).json();
    expect(before.stepUpSatisfied).toBe(false);
    expect(before.retained.length).toBeGreaterThan(0);

    await recordStepUp(a.userId, a.jti, "otp");
    const after = await (await accountGET(req("GET", { token: a.token }))).json();
    expect(after.stepUpSatisfied).toBe(true);
  });
});
