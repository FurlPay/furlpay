import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { GET as carGet, POST as carPost } from "@/app/api/actions/book-car/route";
import { GET as payGet, POST as payPost } from "@/app/api/actions/pay/[orderId]/route";
import { GET as teamGet, POST as teamPost } from "@/app/api/travel/business/team/route";
import { GET as policyGet, PATCH as policyPatch } from "@/app/api/travel/business/policies/route";
import { buildPaymentTransaction, MerchantWalletNotConfiguredError } from "@/lib/actions/solana";
import { handleCommand } from "@/lib/discord";
import { handleUpdate } from "@/lib/telegram";

// Zero-mock audit, round 2 (2026-10-01). Each surface below served or CHARGED
// for something invented: a $25 "order" for any id, a hash-generated rental
// car, an ownerless team with a self-declared USDC balance, a bot posting
// generated fares, and payments addressed to the System Program when no
// merchant treasury was configured. None of that may reach production.

let ip = 0;
const nreq = (url: string, init: RequestInit = {}) =>
  new NextRequest(`http://localhost${url}`, {
    ...init,
    headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${(ip++ % 200) + 1}`, ...(init.headers ?? {}) },
  });
const payer = Keypair.generate().publicKey.toBase58();

afterEach(() => vi.unstubAllEnvs());

describe("Solana Blinks refuse to sell what does not exist (production)", () => {
  it("pay/[orderId]: GET and POST answer 503 with the Action CORS headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const params = { params: Promise.resolve({ orderId: "anything-at-all" }) };
    for (const res of [
      await payGet(new Request("http://localhost/api/actions/pay/x"), params),
      await payPost(new Request("http://localhost/api/actions/pay/x", { method: "POST", body: JSON.stringify({ account: payer }) }), params),
    ]) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toBe("not_available");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("x-action-version")).toBeTruthy();
    }
  });

  it("book-car: GET and POST answer 503, no transaction is built", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MERCHANT_SOLANA_WALLET", Keypair.generate().publicKey.toBase58());
    const get = await carGet(nreq("/api/actions/book-car?city=Tokyo"));
    const post = await carPost(new Request("http://localhost/api/actions/book-car?city=Tokyo&days=2", { method: "POST", body: JSON.stringify({ account: payer }) }));
    for (const res of [get, post]) {
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.transaction).toBeUndefined();
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });
});

describe("no merchant treasury → no payment, in any environment", () => {
  it("buildPaymentTransaction refuses instead of paying the System Program", async () => {
    vi.stubEnv("MERCHANT_SOLANA_WALLET", "");
    await expect(buildPaymentTransaction({ payer: new PublicKey(payer), amountUsd: 25, asset: "USDC" })).rejects.toBeInstanceOf(
      MerchantWalletNotConfiguredError
    );
  });

  it("a treasury configured AS the System Program is refused too", async () => {
    vi.stubEnv("MERCHANT_SOLANA_WALLET", "11111111111111111111111111111111");
    await expect(buildPaymentTransaction({ payer: new PublicKey(payer), amountUsd: 25, asset: "USDC" })).rejects.toBeInstanceOf(
      MerchantWalletNotConfiguredError
    );
  });

  it("the Blink answers 503, not a signable transaction (development)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MERCHANT_SOLANA_WALLET", "");
    const res = await payPost(
      new Request("http://localhost/api/actions/pay/o1", { method: "POST", body: JSON.stringify({ account: payer }) }),
      { params: Promise.resolve({ orderId: "o1" }) }
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).transaction).toBeUndefined();
  });
});

describe("business travel teams (ownerless, in-memory) are not served in production", () => {
  it("team create/read and policy read/write all answer 503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const created = await teamPost(nreq("/api/travel/business/team", { method: "POST", body: JSON.stringify({ name: "x", walletUsdc: 1_000_000 }) }));
    expect(created.status).toBe(503);
    expect((await teamGet(nreq("/api/travel/business/team"))).status).toBe(503);
    expect((await policyGet(nreq("/api/travel/business/policies"))).status).toBe(503);
    const patched = await policyPatch(nreq("/api/travel/business/policies", { method: "PATCH", body: JSON.stringify({ approvalThresholdUsd: 999_999 }) }));
    expect(patched.status).toBe(503);
  });

  it("development validates the body (AGENTS rule 1) instead of coercing it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const bad = await teamPost(nreq("/api/travel/business/team", { method: "POST", body: JSON.stringify({ name: "x", members: [{ email: "not-an-email", role: "owner" }] }) }));
    expect(bad.status).toBe(400);
    const badPolicy = await policyPatch(nreq("/api/travel/business/policies", { method: "PATCH", body: JSON.stringify({ mccLocks: ["lodging"] }) }));
    expect(badPolicy.status).toBe(400);
  });
});

describe("bots never post a generated fare in production", () => {
  const PRICE = /\$\d/;

  it("Discord /flights links to the live search with no price", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = JSON.stringify(
      await handleCommand({ type: 2, data: { name: "flights", options: [{ name: "from", value: "LHR" }, { name: "to", value: "JFK" }] } } as never)
    );
    expect(r).not.toMatch(PRICE);
    expect(r).toContain("/travel/flights?from=LHR&to=JFK");
  });

  it("Telegram /flights links to the live search with no price", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const r = JSON.stringify(await handleUpdate({ message: { chat: { id: 1 }, text: "/flights LHR JFK 2026-12-01" } } as never));
    expect(r).not.toMatch(PRICE);
    expect(r).toContain("/travel/flights?from=LHR&to=JFK");
  });

  it("development still shows the demo fares (unchanged behaviour)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const r = JSON.stringify(await handleUpdate({ message: { chat: { id: 1 }, text: "/flights LHR JFK 2026-12-01" } } as never));
    expect(r).toMatch(PRICE);
  });
});
