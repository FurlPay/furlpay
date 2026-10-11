import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backoffMs, bvnkClient, BvnkApiError, BvnkMoneyMovementDisabled, BvnkOutcomeUnknown, quoteAcceptable } from "../client";
import { BvnkNotConfigured } from "../config";
import { transfer } from "../schemas";

// No network: fetch is a stub. Response bodies are BVNK's documented examples.
const doc = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `response-${name}.json`), "utf8"));
const ENV = { BVNK_ENVIRONMENT: "sandbox", BVNK_HAWK_AUTH_ID: "hawk-id", BVNK_HAWK_AUTH_KEY: "hawk-key" } as unknown as NodeJS.ProcessEnv;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const TID = "d4a904e0-b040-4132-a6d3-ed7d03cdfce7";
const KEY = "1e74002e-74a1-48fd-b707-147c3187a3e1";
const req = { reference: "furlpay-op-1", originator: { walletId: "a:25072267284363:kd3mRMO:1", currency: "USD", amount: 10.5 }, beneficiary: { walletId: "a:25072267284363:kd3mRMO:2", currency: "EUR" }, conversion: { type: "QUOTE" as const } };

function setup(responses: (Response | Error)[], env: NodeJS.ProcessEnv = ENV) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = bvnkClient({ fetch: fetch as unknown as typeof globalThis.fetch, env, now: () => 1_700_000_000_000, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  return { client, calls, sleeps };
}

describe("configuration", () => {
  it("calls nothing when BVNK is not configured", async () => {
    const { client, calls } = setup([], {} as NodeJS.ProcessEnv);
    await expect(client.getTransfer(TID)).rejects.toBeInstanceOf(BvnkNotConfigured);
    expect(calls).toHaveLength(0);
  });

  it("signs with Hawk against the sandbox base URL", async () => {
    const { client, calls } = setup([json(200, doc("transfer-read-v-3"))]);
    await client.getTransfer(TID);
    expect(calls[0].url).toBe(`https://api.sandbox.bvnk.com/payment/v3/transfers/${TID}`);
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Hawk id="hawk-id", ts="1700000000", nonce="[A-Za-z0-9]{6}", mac="[A-Za-z0-9+/]{43}="$/);
    expect(JSON.stringify(calls[0].init)).not.toContain("hawk-key");
  });
});

describe("documented responses", () => {
  it.each([["transfer-read-v-3"], ["transfer-create-v-3"]])("%s parses as a transfer", (name) => {
    expect(transfer.safeParse(doc(name)).success).toBe(true);
  });

  it("parses the documented wallet list and wallet with its virtual account", async () => {
    const { client } = setup([json(200, doc("ledger-wallet-list-v-2")), json(200, doc("ledger-wallet-read-v-2"))]);
    const page = await client.listWallets({ pageSize: 500 });
    expect(page.content.length).toBeGreaterThan(0);
    const w = await client.getWallet(page.content[0].id);
    expect(w.paymentInstruments?.[0]?.accountNumber).toBeTruthy();
  });

  it("caps wallet page size at BVNK's documented maximum of 100", async () => {
    const { client, calls } = setup([json(200, doc("ledger-wallet-list-v-2"))]);
    await client.listWallets({ pageSize: 500 });
    expect(new URL(calls[0].url).searchParams.get("pageSize")).toBe("100");
  });

  it("refuses a 2xx body that does not match the documented contract", async () => {
    const { client } = setup([json(200, { ...doc("transfer-read-v-3"), status: "SETTLED" })]);
    await expect(client.getTransfer(TID)).rejects.toThrow(/documented contract/);
  });
});

describe("retries", () => {
  it("retries a read on 429 and 5xx, honouring Retry-After, then succeeds", async () => {
    const { client, calls, sleeps } = setup([json(429, {}, { "retry-after": "2" }), json(503, {}), json(200, doc("transfer-read-v-3"))]);
    await client.getTransfer(TID);
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeLessThanOrEqual(600);
  });

  it("gives up after three attempts", async () => {
    const { client, calls } = setup([json(503, {}), json(503, {}), json(503, {})]);
    await expect(client.getTransfer(TID)).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    expect(calls).toHaveLength(3);
  });

  it("does not retry a read on a 4xx other than 429", async () => {
    const { client, calls } = setup([json(404, { code: "bvnk:payment:0031", message: "not found" })]);
    await expect(client.getTransfer(TID)).rejects.toMatchObject({ httpStatus: 404, code: "bvnk:payment:0031", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("never retries a POST, even on 503", async () => {
    const { client, calls } = setup([json(503, {})]);
    await expect(client.transferDryRun(req)).rejects.toBeInstanceOf(BvnkApiError);
    expect(calls).toHaveLength(1);
  });

  it("reports a POST with no response as outcome-unknown, not as failed", async () => {
    const { client } = setup([new DOMException("timed out", "TimeoutError")], { ...ENV, BVNK_MONEY_MOVEMENT_ENABLED: "1" });
    await expect(client.createTransfer(req, KEY)).rejects.toBeInstanceOf(BvnkOutcomeUnknown);
  });

  it("backs off with capped full jitter", () => {
    expect(backoffMs(0, null, () => 1)).toBe(300);
    expect(backoffMs(10, null, () => 1)).toBe(5000);
    expect(backoffMs(3, "999", () => 1)).toBe(30_000);
  });
});

describe("money movement", () => {
  it("is refused unless BVNK_MONEY_MOVEMENT_ENABLED=1, before any request", async () => {
    const { client, calls } = setup([]);
    await expect(client.createTransfer(req, KEY)).rejects.toBeInstanceOf(BvnkMoneyMovementDisabled);
    await expect(client.acceptQuote(TID, "digest")).rejects.toBeInstanceOf(BvnkMoneyMovementDisabled);
    await expect(client.refreshQuote(TID)).rejects.toBeInstanceOf(BvnkMoneyMovementDisabled);
    expect(calls).toHaveLength(0);
  });

  it("sends the caller's UUID Idempotency-Key and refuses anything else", async () => {
    const env = { ...ENV, BVNK_MONEY_MOVEMENT_ENABLED: "1" } as NodeJS.ProcessEnv;
    const { client, calls } = setup([json(201, doc("transfer-create-v-3"))], env);
    await client.createTransfer(req, KEY);
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe(KEY);
    await expect(client.createTransfer(req, "not-a-uuid")).rejects.toThrow();
  });

  it("requires exactly one of originator.amount and beneficiary.amount, positive and finite", async () => {
    const { client } = setup([]);
    await expect(client.transferDryRun({ ...req, beneficiary: { ...req.beneficiary, amount: 5 } })).rejects.toThrow(/exactly one/);
    await expect(client.transferDryRun({ ...req, originator: { ...req.originator, amount: undefined } })).rejects.toThrow(/exactly one/);
    await expect(client.transferDryRun({ ...req, originator: { ...req.originator, amount: -1 } })).rejects.toThrow();
  });

  it("accepting a quote needs its digest", async () => {
    const { client, calls } = setup([], { ...ENV, BVNK_MONEY_MOVEMENT_ENABLED: "1" } as NodeJS.ProcessEnv);
    await expect(client.acceptQuote(TID, "")).rejects.toThrow(/digest/);
    expect(calls).toHaveLength(0);
  });
});

describe("quote acceptance window", () => {
  const pending = { ...doc("transfer-create-v-3"), conversion: { ...doc("transfer-create-v-3").conversion, digest: "dg", expiresAt: "2026-05-14T10:51:14Z" } };
  it("allows a pending quote with a digest before it expires", () => {
    expect(quoteAcceptable(transfer.parse(pending), Date.parse("2026-05-14T10:51:00Z"))).toEqual({ ok: true, digest: "dg" });
  });
  it("refuses an expired quote, a missing digest and any status but PENDING_QUOTE_ACCEPTANCE", () => {
    expect(quoteAcceptable(transfer.parse(pending), Date.parse("2026-05-14T10:52:00Z"))).toMatchObject({ ok: false, reason: "quote expired" });
    expect(quoteAcceptable(transfer.parse({ ...pending, conversion: { ...pending.conversion, digest: undefined } }), 0)).toMatchObject({ ok: false });
    for (const status of ["PROCESSING", "EXPIRED", "COMPLETED", "FAILED"]) {
      expect(quoteAcceptable(transfer.parse({ ...pending, status }), 0)).toMatchObject({ ok: false, reason: `transfer is ${status}` });
    }
  });
});

describe("signing across retries", () => {
  it("signs every retry afresh (new nonce), so a retried read is never a replayed signature", async () => {
    const { client, calls } = setup([json(503, {}), json(200, doc("transfer-read-v-3"))]);
    await client.getTransfer(TID);
    const auths = calls.map((c) => (c.init.headers as Record<string, string>).Authorization);
    expect(auths[0]).not.toBe(auths[1]);
  });
});
