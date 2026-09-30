// ---------------------------------------------------------------------------
// Regression: user-visible financial data must be the CALLER's and must be
// real — never the seeded demo account's, never a fixture served as fact.
//
// Every case below was a production defect found by the Sep 30 2026 gap audit
// (docs/audit/PRODUCTION_GAP_AUDIT.md). Each assertion fails if its fix is
// reverted:
//
//   PGA-001  /api/chat answered every user from the demo account
//   PGA-002  /api/analytics/graph built every user's graph from the demo account
//   PGA-003  /api/receipts/match: demo transactions, one global match map, no Zod
//   PGA-004  /api/credit reported $1,200 drawn to every user
//   PGA-005  /api/rewards + travel referrals served fixed earnings to everyone
//   PGA-006  /api/bills "pay" recorded a settled payment with no money moved
//   PGA-007  /api/payouts/payroll fell back to placeholder-address recipients
//   PGA-008  /api/travel/cards/create issued an "active" card with no gate/auth
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, newTx, recordTransaction, db } from "@/lib/store";
import { flagState } from "@/lib/flags";
import { POST as chatPOST } from "@/app/api/chat/route";
import { GET as graphGET } from "@/app/api/analytics/graph/route";
import { GET as receiptsGET, POST as receiptsPOST } from "@/app/api/receipts/match/route";
import { GET as creditGET } from "@/app/api/credit/route";
import { GET as rewardsGET } from "@/app/api/rewards/route";
import { POST as billsPOST } from "@/app/api/bills/route";
import { GET as referralGET } from "@/app/api/travel/referral/route";
import { POST as referralTrackPOST } from "@/app/api/travel/referral/track/route";
import { GET as payrollGET, POST as payrollPOST } from "@/app/api/payouts/payroll/route";
import { POST as travelCardPOST } from "@/app/api/travel/cards/create/route";
import { GET as scheduleGET, POST as schedulePOST } from "@/app/api/investing/schedule/route";
import { POST as compliancePOST } from "@/app/api/compliance/route";
import { GET as jurisdictionGET } from "@/app/api/compliance/jurisdiction/route";
import { POST as rewardClaimPOST } from "@/app/api/travel/rewards/claim/route";
import { POST as spendPOST } from "@/app/api/account/spend/route";

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `fab-${randomUUID()}@furlpay.test`,
    name: "Fabrication Probe",
  });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { account, token };
}

function req(path: string, token: string | undefined, method: "GET" | "POST", body?: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // A distinct IP per request so per-IP rate limits never couple the cases.
    "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  // The co-pilot's optional LLM phrasing must not run in a unit test; the
  // deterministic reply is what carries the grounded numbers.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.FURLPAY_MONEY_KILL_SWITCH;
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

function asProduction() {
  process.env.FURLPAY_ENV = "production";
}
function asDevelopment() {
  process.env.FURLPAY_ENV = "development";
}

describe("PGA-001 co-pilot answers from the caller's account", () => {
  it("401s without a session", async () => {
    const res = await chatPOST(req("/chat", undefined, "POST", { messages: [{ role: "user", content: "balance" }] }));
    expect(res.status).toBe(401);
  });

  it("reports the caller's net worth, not the demo account's", async () => {
    const demoNetWorth = db.tokenBalances.reduce((s, b) => s + b.usdValue, 0);
    expect(demoNetWorth).toBeGreaterThan(0); // the demo account is populated

    const a = await actor(); // a fresh account holds nothing
    const res = await chatPOST(req("/chat", a.token, "POST", { messages: [{ role: "user", content: "what's my balance?" }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent).toBe("balance");
    expect(body.data.netWorth).toBe(0);
    expect(body.reply).not.toContain(demoNetWorth.toLocaleString());
  });

  it("never quotes the old hardcoded yield table, and offers no deposit when Earn is not live", async () => {
    delete process.env.INTEGRATION_MODE; // earnIsLive() is false
    const a = await actor();
    const res = await chatPOST(req("/chat", a.token, "POST", { messages: [{ role: "user", content: "earn yield on idle usdc" }] }));
    const body = await res.json();
    expect(body.intent).toBe("earn");
    expect(body.data.available).toBe(false);
    expect(body.requiresConfirmation).toBeUndefined();
    for (const invented of ["8.2%", "9.5%", "6.4%", "Aave v3"]) expect(body.reply).not.toContain(invented);
  });

  it("does not invent hotel listings", async () => {
    const a = await actor();
    const res = await chatPOST(req("/chat", a.token, "POST", { messages: [{ role: "user", content: "book a hotel in Tokyo" }] }));
    const body = await res.json();
    expect(body.intent).toBe("travel");
    expect(body.data.stays).toBeUndefined();
    expect(body.reply).not.toMatch(/\/night/);
  });
});

describe("PGA-002 analytics graph is the caller's", () => {
  it("401s without a session", async () => {
    expect((await graphGET(req("/analytics/graph", undefined, "GET"))).status).toBe(401);
  });

  it("a fresh account's graph has only the user node", async () => {
    expect(db.transactions.length).toBeGreaterThan(0); // demo account has history to leak
    const a = await actor();
    const body = await (await graphGET(req("/analytics/graph", a.token, "GET"))).json();
    expect(body.nodes.map((n: { type: string }) => n.type)).toEqual(["user"]);
  });
});

describe("PGA-003 receipt matching is per-user and validated", () => {
  it("401s without a session", async () => {
    expect((await receiptsGET(req("/receipts/match", undefined, "GET"))).status).toBe(401);
    expect(
      (await receiptsPOST(req("/receipts/match", undefined, "POST", { receipts: [] }))).status
    ).toBe(401);
  });

  it("rejects a malformed batch", async () => {
    const a = await actor();
    const res = await receiptsPOST(
      req("/receipts/match", a.token, "POST", { receipts: [{ merchant: "x", amountUsd: -5, date: "yesterday" }] })
    );
    expect(res.status).toBe(400);
  });

  it("one user's matches are invisible to another", async () => {
    const a = await actor();
    const b = await actor();
    const tx = newTx({
      category: "travel",
      direction: "out",
      title: "Park Hyatt Tokyo",
      subtitle: "card",
      amountUsd: 412,
      token: "USDC",
      status: "settled",
    });
    recordTransaction(a.account.user.id, tx);

    const matched = await (
      await receiptsPOST(
        req("/receipts/match", a.token, "POST", {
          receipts: [{ merchant: "Park Hyatt Tokyo", amountUsd: 412, date: tx.timestamp, reference: "CONF-SECRET-1" }],
        })
      )
    ).json();
    expect(matched.matched).toBe(1);

    const seenByB = await (await receiptsGET(req("/receipts/match", b.token, "GET"))).json();
    expect(seenByB.reconciled).toBe(0);
    expect(JSON.stringify(seenByB)).not.toContain("CONF-SECRET-1");
  });
});

describe("PGA-004..008 unimplemented money capabilities are 503 in production", () => {
  it("credit", async () => {
    asProduction();
    const a = await actor();
    const res = await creditGET(req("/credit", a.token, "GET"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.capability).toBe("CREDIT_LIVE");
    expect(JSON.stringify(body)).not.toContain("1200");
  });

  it("rewards and both travel referral routes", async () => {
    asProduction();
    const a = await actor();
    const rewards = await rewardsGET(req("/rewards", a.token, "GET"));
    expect(rewards.status).toBe(503);
    expect(JSON.stringify(await rewards.json())).not.toContain("ASHU2026");

    expect((await referralGET(req("/travel/referral", a.token, "GET"))).status).toBe(503);
    expect(
      (await referralTrackPOST(req("/travel/referral/track", undefined, "POST", { code: "X", event: "first_booking" }))).status
    ).toBe(503);
  });

  it("bill pay, including autopay", async () => {
    asProduction();
    const a = await actor();
    for (const action of ["pay", "toggleAutopay"]) {
      const res = await billsPOST(req("/bills", a.token, "POST", { id: "any", action }));
      expect(res.status).toBe(503);
    }
  });

  it("travel virtual card requires a session and the card-issuer gate", async () => {
    asProduction();
    expect((await travelCardPOST(req("/travel/cards/create", undefined, "POST", { limitUsd: 100 }))).status).toBe(401);
    const a = await actor();
    const res = await travelCardPOST(req("/travel/cards/create", a.token, "POST", { limitUsd: 100 }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('"active"');
  });
});

describe("outside production the fixtures still run, and say they are fixtures", () => {
  it("credit and rewards carry simulated: true", async () => {
    asDevelopment();
    const a = await actor();
    expect((await (await creditGET(req("/credit", a.token, "GET"))).json()).simulated).toBe(true);
    expect((await (await rewardsGET(req("/rewards", a.token, "GET"))).json()).simulated).toBe(true);
  });
});

describe("PGA-007 payroll never pays a roster the caller did not send", () => {
  const PLACEHOLDERS = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"];

  it("GET requires a session and returns no fabricated roster", async () => {
    expect((await payrollGET(req("/payouts/payroll", undefined, "GET"))).status).toBe(401);
    const a = await actor();
    const body = await (await payrollGET(req("/payouts/payroll", a.token, "GET"))).json();
    expect(body.roster).toEqual([]);
    for (const p of PLACEHOLDERS) expect(JSON.stringify(body)).not.toContain(p);
  });

  it("POST without employees is rejected rather than defaulted", async () => {
    const a = await actor();
    const res = await payrollPOST(req("/payouts/payroll", a.token, "POST", { sourceChain: "arbitrum" }));
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    for (const p of PLACEHOLDERS) expect(text).not.toContain(p);
  });
});

describe("the new flags cannot be switched on by configuration", () => {
  it.each(["CREDIT_LIVE", "BILL_PAY_LIVE", "REWARDS_LIVE"] as const)("%s stays off with every env var set", (flag) => {
    asProduction();
    process.env[flag] = "true";
    process.env.FURLPAY_CREDIT_PROVIDER = "x";
    process.env.FURLPAY_CREDIT_PROVIDER_API_KEY = "x";
    process.env.FURLPAY_BILLPAY_PROVIDER = "x";
    process.env.FURLPAY_BILLPAY_PROVIDER_API_KEY = "x";
    process.env.FURLPAY_REWARDS_LEDGER = "x";
    const state = flagState(flag);
    expect(state.on).toBe(false);
    expect(state.blocker?.reason).toBe("unimplemented");
  });
});

// PGA-009: recurring investing had no durable store and no executor, but
// returned a `nextRun` as if the schedule would run; the co-pilot offered to
// "activate" one. It is gated on RECURRING_INVESTING_LIVE.

describe("PGA-009 recurring investing never promises an execution that cannot happen", () => {
  it("creation is 503 in production", async () => {
    asProduction();
    const a = await actor();
    const res = await schedulePOST(
      req("/investing/schedule", a.token, "POST", { symbol: "VOO", notional: 50, cadence: "week" })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).capability).toBe("RECURRING_INVESTING_LIVE");
  });

  it("every response states that nothing executes automatically", async () => {
    asDevelopment();
    const a = await actor();
    const list = await (await scheduleGET(req("/investing/schedule", a.token, "GET"))).json();
    expect(list.automaticExecution).toBe(false);
  });

  it("the co-pilot offers no schedule confirmation in production", async () => {
    asProduction();
    const a = await actor();
    const body = await (
      await chatPOST(req("/chat", a.token, "POST", { messages: [{ role: "user", content: "invest $50 in VOO every week" }] }))
    ).json();
    expect(body.intent).toBe("invest_dca");
    expect(body.requiresConfirmation).toBeUndefined();
  });

  it("RECURRING_INVESTING_LIVE cannot be switched on by configuration", () => {
    asProduction();
    process.env.RECURRING_INVESTING_LIVE = "true";
    process.env.ALPACA_API_KEY_ID = "x";
    process.env.ALPACA_API_SECRET_KEY = "x";
    process.env.CRON_SECRET = "x";
    expect(flagState("RECURRING_INVESTING_LIVE").blocker?.reason).toBe("unimplemented");
  });
});

// PGA-010: compliance decisions were computed from the demo account's region
// ("EEA") for every caller. Deposit routing now needs a session; the public
// jurisdiction resolver uses a KYC region only when a caller is signed in.
describe("PGA-010 compliance uses the caller's region, never the demo account's", () => {
  it("deposit routing requires a session", async () => {
    expect((await compliancePOST(req("/compliance", undefined, "POST", { token: "USDT" }))).status).toBe(401);
  });

  it("a non-EEA caller's USDT is not MiCA-swapped", async () => {
    const a = await actor();
    a.account.user.region = "US";
    const body = await (await compliancePOST(req("/compliance", a.token, "POST", { token: "USDT" }))).json();
    expect(body.decision.autoSwapped).toBe(false);
  });

  it("an anonymous jurisdiction query is not resolved as the demo user's EEA", async () => {
    // Before the fix this came back {regime: "EEA", source: "kyc"} with USDT
    // routed to EURC under MiCA — the demo account's KYC region outranking the
    // country the caller asked about.
    const res = await jurisdictionGET(req("/compliance/jurisdiction?country=US&token=USDT", undefined, "GET"));
    expect(res.status).toBe(200);
    const { policy } = await res.json();
    expect(policy.regime).toBe("US");
    expect(policy.source).toBe("country");
  });
});

// PGA2-004 / PGA2-005 (second pass): a fabricated withdrawal receipt, and a
// debit of a real balance with nowhere for the money to go.
describe("second pass: no fabricated money movement in production", () => {
  it("travel reward claims are 503 — no random txHash, no repeatable withdrawal", async () => {
    asProduction();
    const a = await actor();
    const res = await rewardClaimPOST(req("/travel/rewards/claim", a.token, "POST", { amountUsdc: 5 }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/"txHash":"0x/);
  });

  it("spending from the account balance is 503 — no debit into a fabricated on-chain label", async () => {
    asProduction();
    const a = await actor();
    const res = await spendPOST(req("/account/spend", a.token, "POST", { amountUsd: 10, memo: "x", purpose: "card" }));
    expect(res.status).toBe(503);
    expect((await res.json()).capability).toBe("ACCOUNT_SPEND_LIVE");
  });
});
