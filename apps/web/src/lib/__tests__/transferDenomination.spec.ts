// /api/wallets/transfer — `amount` is TOKEN units, and USD is derived from it.
//
// The route had one number doing two jobs. It debited the token balance by
// `amount` (`src.amount -= amount`) while ALSO handing the same figure to every
// USD-denominated gate on the way there: the KYC per-transfer cap, the velocity
// ceiling, the $5,000 step-up threshold, the transaction record and the
// double-entry ledger. For USDC the two readings coincide and nothing showed.
// For any token off par — EURC at $1.08, XSGD at $0.74 — the gates were scaled
// wrong and the ledger recorded a dollar figure that was really a token count.
//
// The native app had the mirror-image bug: it posted the USD figure the amount
// field is denominated in, so the route spent dollars as euros. Fixing only one
// side would have swapped which direction the error ran, so these pin the
// contract itself: token units on the wire, USD derived from the caller's own
// priced balance.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as transferPOST } from "@/app/api/wallets/transfer/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";

const DESTINATION = "0x52908400098527886E0F7030069857D2E4169EE7";

/** EURC at $1.08 — a stablecoin, and still not a dollar. */
const EURC_RATE = 1.08;

async function actor(balance: { token: string; chain: string; amount: number; usdValue: number }) {
  const email = `denom-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Denomination User" });
  account.user.kycStatus = "verified";
  // Tier 3 caps a single transfer at $100,000, so these exercise the
  // denomination logic rather than the tier ceiling.
  account.user.kycTier = 3;
  // Sole balance, so the route cannot pick a different one.
  account.tokenBalances = [balance as (typeof account.tokenBalances)[number]];
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
      // Distinct IP per request so the per-user limiter, not the IP baseline,
      // is what these exercise.
      "x-forwarded-for": `10.11.0.${Math.floor(Math.random() * 250)}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

const eurc = (amount: number) => ({
  token: "EURC",
  chain: "base",
  amount,
  usdValue: Math.round(amount * EURC_RATE * 100) / 100,
});

describe("POST /api/wallets/transfer — amount is denominated in tokens", () => {
  it("debits exactly the token quantity that was sent", async () => {
    const a = await actor(eurc(1000));

    const res = await transferPOST(
      req(a.token, {
        destination: DESTINATION,
        amount: 100, // 100 EURC, worth $108
        token: "EURC",
        chain: "base",
        signature: "0x" + "ab".repeat(65),
      })
    );
    expect(res.status).toBe(200);

    const balance = getAccount(a.id)!.tokenBalances.find((b) => b.token === "EURC")!;
    // 100 EURC left, not 100 dollars' worth (92.59 EURC) and not $108 of them.
    expect(balance.amount).toBe(900);
    // And the remainder is still marked at the same rate, not collapsed to 1:1.
    expect(balance.usdValue).toBeCloseTo(900 * EURC_RATE, 2);
  });

  it("records the transaction in real dollars, not in token units", async () => {
    const a = await actor(eurc(1000));

    await transferPOST(
      req(a.token, {
        destination: DESTINATION,
        amount: 100,
        token: "EURC",
        chain: "base",
        signature: "0x" + "cd".repeat(65),
      })
    );

    const tx = getAccount(a.id)!.transactions.find((t) => t.category === "transfer");
    // The history line the user reads. Recording 100 here would understate a
    // $108 transfer by the FX spread on every non-dollar token.
    expect(tx?.amountUsd).toBeCloseTo(108, 2);
  });

  it("scales the step-up threshold by USD value, not by token count", async () => {
    // 4,800 EURC is $5,184 — over the $5,000 step-up line even though the token
    // count is under it. Reading the raw number as dollars let a five-figure
    // transfer through with no second factor.
    const a = await actor(eurc(10_000));

    const res = await transferPOST(
      req(a.token, {
        destination: DESTINATION,
        amount: 4_800,
        token: "EURC",
        chain: "base",
        signature: "0x" + "ef".repeat(65),
      })
    );

    expect(res.status).toBe(401);
    expect((await res.json()).stepUpRequired).toBe(true);
    // Nothing moved.
    expect(getAccount(a.id)!.tokenBalances[0].amount).toBe(10_000);
  });

  it("compares the funds check against the token balance", async () => {
    // 900 EURC is only $972, so a USD-denominated funds check would have
    // allowed it out of a 800-EURC balance.
    const a = await actor(eurc(800));

    const res = await transferPOST(
      req(a.token, {
        destination: DESTINATION,
        amount: 900,
        token: "EURC",
        chain: "base",
        signature: "0x" + "12".repeat(65),
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Insufficient EURC/);
    expect(getAccount(a.id)!.tokenBalances[0].amount).toBe(800);
  });

  it("leaves a 1:1 stablecoin behaving exactly as before", async () => {
    // The regression guard for the fix itself: USDC must be untouched by the
    // conversion, since token units and dollars coincide there.
    const a = await actor({ token: "USDC", chain: "base", amount: 500, usdValue: 500 });

    const res = await transferPOST(
      req(a.token, {
        destination: DESTINATION,
        amount: 120,
        token: "USDC",
        chain: "base",
        signature: "0x" + "34".repeat(65),
      })
    );
    expect(res.status).toBe(200);

    const balance = getAccount(a.id)!.tokenBalances[0];
    expect(balance.amount).toBe(380);
    expect(balance.usdValue).toBeCloseTo(380, 2);
  });
});
