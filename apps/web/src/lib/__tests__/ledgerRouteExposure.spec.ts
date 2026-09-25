import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { signSession } from "@/lib/session";
import { FOUNDER_ADMIN_EMAIL } from "@/lib/authz";
import { recordMovement } from "@/lib/ledger";
import { GET as ledgerGET } from "@/app/api/ledger/route";

// ---------------------------------------------------------------------------
// GET /api/ledger — regression tests for an unauthenticated disclosure of every
// user's balance, found and fixed during the 2026-09-25 audit.
//
// THE BUG. The route exists to prove the books balance, which is a reasonable
// thing to want. The problem was WHAT it enumerated. lib/ledger.ts opens a real
// ledger account per user:
//
//   userFiatLiability(userId) -> { id: `acct_2000_${userId}`,
//                                  code: `2000:${userId}`,
//                                  name: `Customer fiat liability ${userId}` }
//
// and `openMirror` registers it in the SAME ledger instance that the route walks
// with `ledger.listAccounts()`, attaching `balanceCents: ledger.balanceOf(a.id)`
// to each one. So the "chart of accounts" is not a fixed chart — it grows a row
// per customer, carrying that customer's id in two fields and their exact
// balance in a third.
//
// No session was required. The only control was a 60/min rate limit, which
// bounded how fast the whole customer list could be read, not whether it could
// be. Verified before fixing: a victim funded with $987.65 came back as
// balanceCents 98765 beside their user id, to a caller with no credential.
//
// THE FIX is two independent controls, because either alone leaves a sharp edge:
// requireRole("admin"), and exclusion of per-customer rows from the payload
// whoever asks. The tests below pin both.
// ---------------------------------------------------------------------------

function anonymousRequest() {
  return new NextRequest("https://furlpay.com/api/ledger", {
    method: "GET",
    headers: { "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}` },
  });
}

function authenticatedRequest(token: string) {
  return new NextRequest("https://furlpay.com/api/ledger", {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `10.9.1.${Math.floor(Math.random() * 250)}`,
    },
  });
}

describe("GET /api/ledger must not leak per-user balances", () => {
  it("REFUSES an unauthenticated caller", async () => {
    // Before the fix this returned 200 with the full chart of accounts. The
    // exploit was verified: a victim funded with $987.65 came back as
    // balanceCents 98765 next to their user id, to a caller with no credential.
    const { account } = findOrCreateUserByIdentity({
      email: `victim-${randomUUID()}@furlpay.test`,
      name: "Victim",
    });
    await recordMovement("in", 987.65, `audit-deposit-${randomUUID()}`, account.user.id);

    const res = await ledgerGET(anonymousRequest());
    expect(res.status, "anonymous access to the ledger must be refused").toBe(401);

    // And nothing leaks in the error body either.
    expect(JSON.stringify(await res.json())).not.toContain(account.user.id);
  });

  it("REFUSES an authenticated NON-admin caller", async () => {
    // Authentication alone is not the control: an ordinary user must not be able
    // to read the platform's books or other customers' positions.
    const { account } = findOrCreateUserByIdentity({
      email: `plain-${randomUUID()}@furlpay.test`,
      name: "Plain User",
    });
    const token = await signSession({
      sub: account.user.id,
      safe: "0x0",
      roles: ["user"],
      jti: randomUUID(),
    });
    const res = await ledgerGET(authenticatedRequest(token));
    expect([401, 403], "a non-admin must be refused").toContain(res.status);
  });

  it("does not enumerate ANY customer to an unauthenticated caller", async () => {
    // This was the severity multiplier: not one user's data leaking to one
    // attacker, but the whole customer list with balances in a single GET.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { account } = findOrCreateUserByIdentity({
        email: `enum-${randomUUID()}@furlpay.test`,
        name: `Enum ${i}`,
      });
      ids.push(account.user.id);
      await recordMovement("in", 100 + i, `audit-enum-${randomUUID()}`, account.user.id);
    }

    const res = await ledgerGET(anonymousRequest());
    const serialised = JSON.stringify(await res.json());
    for (const id of ids) {
      expect(serialised, `${id} must not be anonymously enumerable`).not.toContain(id);
    }
  });

  it("does not expose journal postings to an unauthenticated caller", async () => {
    // A second, independent leak path: postings carry accountIds, and an
    // accountId is `acct_2000_<userId>`, so the journal revealed who moved money
    // and how much even without the accounts array.
    const { account } = findOrCreateUserByIdentity({
      email: `journal-${randomUUID()}@furlpay.test`,
      name: "Journal",
    });
    await recordMovement("in", 42.42, `audit-journal-${randomUUID()}`, account.user.id);

    const res = await ledgerGET(anonymousRequest());
    expect(JSON.stringify(await res.json())).not.toContain(account.user.id);
  });

  it("serves an ADMIN the books WITHOUT naming any customer", async () => {
    // The defence-in-depth half of the fix, and the reason the filter exists
    // rather than relying on the role check alone. An operator auditing the
    // books needs the platform accounts and the balancing invariant; they do not
    // need a dump of customer ids, and if the role check ever regresses there is
    // no customer data in the payload to leak.
    const { account } = findOrCreateUserByIdentity({
      email: `admin-view-${randomUUID()}@furlpay.test`,
      name: "Customer Of Interest",
    });
    await recordMovement("in", 555.55, `audit-admin-${randomUUID()}`, account.user.id);

    const admin = findOrCreateUserByIdentity({
      email: FOUNDER_ADMIN_EMAIL,
      name: "Founder",
    });
    admin.account.user.roles = ["user", "admin"];
    const token = await signSession({
      sub: admin.account.user.id,
      safe: "0x0",
      roles: ["user", "admin"],
      jti: randomUUID(),
    });

    const res = await ledgerGET(authenticatedRequest(token));
    expect(res.status, "the founder admin should be able to read the books").toBe(200);
    const body = (await res.json()) as {
      accounts: { code: string }[];
      customerAggregate: { accountCount: number; totalBalanceCents: number };
      trialBalance: unknown;
    };

    // No customer id anywhere in the response, including the journal.
    expect(JSON.stringify(body)).not.toContain(account.user.id);

    // But the customer position is still reconcilable in aggregate, so the view
    // remains useful for the purpose it exists for.
    expect(body.customerAggregate.accountCount).toBeGreaterThan(0);
    expect(body.trialBalance).toBeDefined();
  });
});
