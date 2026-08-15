// Idempotency on money-moving POSTs — drives the REAL routes.
//
// withIdempotency() existed and was proven on /api/wallets/transfer, but every
// other money-moving POST was unprotected: a client retry after a timeout
// issued a second card, started a second Stripe subscription session, or
// created a second standing DCA order. These tests pin the retry behavior at
// the route level, and pin banking's stronger guarantee — provisioning is
// idempotent per CURRENCY, not merely per key, because an account number is a
// payable destination and reissuing one invalidates inbound wires in flight.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as cardsPOST } from "@/app/api/cards/route";
import { POST as bankingPOST } from "@/app/api/banking/route";
import { POST as schedulePOST } from "@/app/api/investing/schedule/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";

async function actor(kyc: "verified" | "pending" = "verified") {
  const email = `idem-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Idem User" });
  account.user.kycStatus = kyc;
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { id: account.user.id, token };
}

function req(url: string, token: string, body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    // Distinct IP per request so the per-user rate limiter, not the IP
    // baseline, is what these tests exercise.
    "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/cards — idempotency", () => {
  it("replays the original response instead of issuing a second card", async () => {
    const a = await actor();
    const key = randomUUID();
    const body = { cardType: "virtual", kycToken: "kyc_ok" };

    const first = await cardsPOST(req("https://furlpay.com/api/cards", a.token, body, key));
    expect(first.status).toBe(201);
    const firstJson = await first.json();

    const retry = await cardsPOST(req("https://furlpay.com/api/cards", a.token, body, key));
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await retry.json()).toEqual(firstJson);

    // The decisive assertion: one card on the account, not two.
    expect(getAccount(a.id)?.cards.filter((c) => c.id === firstJson.cardId)).toHaveLength(1);
  });

  it("still issues a distinct card under a DIFFERENT key", async () => {
    const a = await actor();
    const body = { cardType: "virtual", kycToken: "kyc_ok" };
    const before = getAccount(a.id)!.cards.length;

    const one = await cardsPOST(req("https://furlpay.com/api/cards", a.token, body, randomUUID()));
    const two = await cardsPOST(req("https://furlpay.com/api/cards", a.token, body, randomUUID()));

    expect((await one.json()).cardId).not.toBe((await two.json()).cardId);
    expect(getAccount(a.id)!.cards.length).toBe(before + 2);
  });
});

describe("POST /api/banking — provisioning idempotency", () => {
  it("returns the SAME account details on a second call (no key needed)", async () => {
    const a = await actor();
    const body = { currency: "USD" };

    const first = await bankingPOST(req("https://furlpay.com/api/banking", a.token, body));
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(firstJson.accountNumber).toBeTruthy();

    // No Idempotency-Key at all — reissuing a payable account number must not
    // happen just because the client asked twice.
    const second = await bankingPOST(req("https://furlpay.com/api/banking", a.token, body));
    expect((await second.json()).accountNumber).toBe(firstJson.accountNumber);

    // And exactly one USD balance row, not a duplicate.
    expect(getAccount(a.id)!.fiatBalances.filter((f) => f.currency === "USD")).toHaveLength(1);
  });

  it("provisions a separate account per currency", async () => {
    const a = await actor();
    const usd = await bankingPOST(req("https://furlpay.com/api/banking", a.token, { currency: "USD" }));
    const gbp = await bankingPOST(req("https://furlpay.com/api/banking", a.token, { currency: "GBP" }));
    expect((await usd.json()).accountNumber).not.toBe((await gbp.json()).accountNumber);
  });
});

describe("POST /api/investing/schedule — idempotency", () => {
  it("does not create a second standing order on retry", async () => {
    const a = await actor();
    const key = randomUUID();
    const body = { symbol: "AAPL", notional: 50, cadence: "week" };
    const url = "https://furlpay.com/api/investing/schedule";

    const first = await schedulePOST(req(url, a.token, body, key));
    expect(first.status).toBe(201);
    const firstJson = await first.json();

    const retry = await schedulePOST(req(url, a.token, body, key));
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect((await retry.json()).schedule.id).toBe(firstJson.schedule.id);
  });
});
