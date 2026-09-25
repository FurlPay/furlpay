// Money routes must post to the LEDGER before mutating balances or claiming a
// transaction settled.
//
// THE BUG THESE PIN. `recordMovement` throws — LedgerDurabilityError when the
// deployment is production without a durable ledger backend
// (lib/ledger.ts assertLedgerDurable), LedgerError on an unpostable amount. Three
// routes called it LAST:
//
//   wallets/transfer     debited `src.amount`, wrote a "settled" transfer, THEN posted
//   investing/order      rewrote holdings, wrote a "settled" trade,      THEN posted
//   offramp              credited fiat,       wrote a "settled" off-ramp, THEN posted
//
// So a ledger outage produced the one combination that cannot be repaired
// automatically: the user's balance had moved, their history said the operation
// had settled, and the double-entry books had no record of it. `credited !=
// ledgered`, with nothing to reconcile against.
//
// Five other paths already had it right — webhooks/stripe, both investing settle
// routes, lib/services/account.ts, lib/services/payments.ts — so the convention
// existed and these three simply diverged from it. That is exactly the kind of
// inconsistency a test has to hold in place, because nothing in the type system
// or the linter can see it.
//
// The residual risk after the fix runs the other way: a ledger entry whose
// presentational record is missing. That is strictly preferable — correct books
// can rebuild a view, a correct view cannot rebuild wrong books.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

// The route captures `recordMovement` at module load, so the mock has to exist
// before the route is imported. `vi.mock` is hoisted above every import, which
// means a plain `const` declared here is still in its temporal dead zone when the
// factory runs — vi.hoisted() is the supported way to lift the spy with it.
const { mockRecordMovement } = vi.hoisted(() => ({ mockRecordMovement: vi.fn() }));
vi.mock("@/lib/ledger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ledger")>("@/lib/ledger");
  return { ...actual, recordMovement: mockRecordMovement };
});

import { POST as transferPOST } from "@/app/api/wallets/transfer/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";

const DESTINATION = "0x52908400098527886E0F7030069857D2E4169EE7";

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `ordering-${randomUUID()}@furlpay.test`,
    name: "Ordering User",
  });
  account.user.kycStatus = "verified";
  account.user.kycTier = 3;
  account.tokenBalances = [
    { token: "USDC", chain: "arbitrum", amount: 500, usdValue: 500 } as (typeof account.tokenBalances)[number],
  ];
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { id: account.user.id, token };
}

function req(token: string, body: unknown) {
  return new NextRequest("https://furlpay.com/api/wallets/transfer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `10.12.0.${Math.floor(Math.random() * 250)}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockRecordMovement.mockReset();
});

describe("wallets/transfer posts to the ledger before moving money", () => {
  it("leaves the balance UNTOUCHED when the ledger refuses to post", async () => {
    // The exact production condition: assertLedgerDurable() throwing because the
    // durable backend is absent or unreachable.
    mockRecordMovement.mockRejectedValue(
      Object.assign(new Error("The ledger has no durable backend."), {
        name: "LedgerDurabilityError",
      })
    );
    const { id, token } = await actor();

    // The route is expected to fail. Whether it throws or returns 5xx is its
    // business; what must NOT happen is a silent partial success.
    await transferPOST(req(token, { destination: DESTINATION, amount: 100, token: "USDC", chain: "arbitrum", signature: "0x" + "ab".repeat(65) })).catch(
      () => undefined
    );

    const after = getAccount(id)!;
    const usdc = after.tokenBalances.find((b) => b.token === "USDC");
    expect(usdc?.amount, "balance must not be debited when the ledger refused").toBe(500);

    // And nothing may claim to have settled.
    const settled = after.transactions.filter(
      (t) => t.category === "transfer" && t.status === "settled"
    );
    expect(settled, "no settled transfer may exist without a ledger entry").toHaveLength(0);
  });

  it("debits and records only AFTER a successful ledger post", async () => {
    mockRecordMovement.mockResolvedValue({ id: "tx_ledger_ok" });
    const { id, token } = await actor();

    const res = await transferPOST(
      req(token, { destination: DESTINATION, amount: 100, token: "USDC", chain: "arbitrum", signature: "0x" + "ab".repeat(65) })
    );
    expect(res.status).toBe(200);
    expect(mockRecordMovement).toHaveBeenCalledTimes(1);

    const after = getAccount(id)!;
    expect(after.tokenBalances.find((b) => b.token === "USDC")?.amount).toBe(400);
    expect(
      after.transactions.some((t) => t.category === "transfer" && t.status === "settled")
    ).toBe(true);
  });

  it("checks funds before the ledger, so an overdraw never reaches it", async () => {
    // Ordering has a second requirement: the cheap local guard still runs first.
    // Posting a ledger entry for a transfer that was going to be refused anyway
    // would put a movement in the books with no counterpart.
    //
    // 1000 against a 500 balance — an overdraw that stays UNDER the $5,000
    // step-up threshold, so the 400 here is the funds check rather than a
    // step-up challenge (which returns 401 and would prove nothing about the
    // funds guard).
    mockRecordMovement.mockResolvedValue({ id: "tx_should_not_happen" });
    const { token } = await actor();

    const res = await transferPOST(
      req(token, { destination: DESTINATION, amount: 1000, token: "USDC", chain: "arbitrum", signature: "0x" + "cd".repeat(65) })
    );
    expect(res.status).toBe(400);
    expect(mockRecordMovement, "an overdraw must not post to the ledger").not.toHaveBeenCalled();
  });
});
