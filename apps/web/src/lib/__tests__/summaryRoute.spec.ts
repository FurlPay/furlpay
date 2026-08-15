// GET /api/summary — drives the REAL route.
//
// lib/spendingSummary.spec.ts covers the windowing maths; this covers the parts
// only the route has: it requires a session, it validates `period` and `tz`
// rather than silently defaulting, and it reports the caller's own ledger.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as summaryGET } from "@/app/api/summary/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import type { Transaction, TxCategory } from "@/lib/types";

async function actor() {
  const email = `summary-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Summary User" });
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { account, token };
}

function req(token: string | undefined, query = "") {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.11.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api/summary${query}`, { headers });
}

function spend(amountUsd: number, category: string): Transaction {
  return {
    id: `tx_${randomUUID()}`,
    category: category as TxCategory,
    direction: "out",
    title: "Test spend",
    subtitle: "",
    amountUsd,
    timestamp: new Date().toISOString(),
    status: "settled",
  } as Transaction;
}

describe("GET /api/summary", () => {
  it("401s an unauthenticated request", async () => {
    expect((await summaryGET(req(undefined))).status).toBe(401);
  });

  it("summarises the CALLER's own transactions", async () => {
    const a = await actor();
    a.account.transactions.length = 0;
    a.account.transactions.push(spend(20, "shopping"), spend(5, "travel"));

    const res = await summaryGET(req(a.token, "?period=today&tz=UTC"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalUsd).toBe(25);
    expect(body.transactionCount).toBe(2);
    expect(body.topCategory).toBe("shopping");
    expect(body.period).toBe("today");
    expect(body.timeZone).toBe("UTC");
  });

  it("defaults to today when no period is given", async () => {
    const a = await actor();
    const body = await (await summaryGET(req(a.token))).json();
    expect(body.period).toBe("today");
  });

  it("rejects an unknown period rather than guessing", async () => {
    const a = await actor();
    const res = await summaryGET(req(a.token, "?period=this_decade"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_period");
  });

  // A wrong "today" is worse than a 400 because the caller cannot tell it was
  // wrong — so an unknown zone must not fall back to UTC.
  it("rejects an unknown time zone rather than falling back to UTC", async () => {
    const a = await actor();
    const res = await summaryGET(req(a.token, "?tz=Mars/Olympus_Mons"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_timezone");
  });

  it("accepts a real IANA zone and reports it back", async () => {
    const a = await actor();
    const body = await (await summaryGET(req(a.token, "?tz=Asia/Kolkata"))).json();
    expect(body.timeZone).toBe("Asia/Kolkata");
    expect(typeof body.since).toBe("string");
  });

  it("never reports another user's spending", async () => {
    const mine = await actor();
    const theirs = await actor();
    mine.account.transactions.length = 0;
    theirs.account.transactions.length = 0;
    theirs.account.transactions.push(spend(999, "shopping"));

    const body = await (await summaryGET(req(mine.token, "?tz=UTC"))).json();
    expect(body.totalUsd).toBe(0);
  });
});
