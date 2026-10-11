import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { custom } from "viem";

// x402 checkout for the browser extension (audit 7 Oct 2026, P1-5). Real
// EIP-712 signatures from a throwaway key; the resource is a fake transport
// standing in for the merchant. Nothing is fetched from the network.

const claimed = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/kv", async (orig) => ({
  ...(await orig<typeof import("@/lib/kv")>()),
  kvSetNx: vi.fn(async (k: string) => {
    if (claimed.has(k)) return false;
    claimed.add(k);
    return true;
  }),
}));
// ERC-1271 fallback (only reached when ECDSA recovery fails): fail fast, offline.
vi.mock("@/lib/x402Chains", async (orig) => ({
  ...(await orig<typeof import("@/lib/x402Chains")>()),
  rpcTransport: () => custom({ request: async () => { throw new Error("offline in tests"); } }),
}));

import { checkResource, fetchTerms, parseTerms, payResource, type CheckoutTerms } from "@/lib/x402Checkout";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const RESOURCE = "https://93.184.216.34/premium/report"; // literal public IP: no DNS in tests
const payer = privateKeyToAccount(generatePrivateKey());

const v1Body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    x402Version: 1,
    accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "250000", resource: RESOURCE, description: "Report", payTo: PAY_TO, asset: BASE_USDC, maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" }, ...over }],
  });

type Seen = { headers: Record<string, string> }[];
function merchant(opts: { body?: string; status?: number; v2?: boolean; redirect?: boolean } = {}) {
  const seen: Seen = [];
  const transport = vi.fn(async (_url: URL, _addr: string, o: { headers: Record<string, string> }) => {
    seen.push({ headers: o.headers });
    if (opts.redirect) return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    const paid = o.headers["X-PAYMENT"] || o.headers["PAYMENT-SIGNATURE"];
    if (paid) return new Response(JSON.stringify({ report: "ok" }), { status: 200, headers: { "content-type": "application/json", "x-payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "0xabc" })).toString("base64") } });
    if (opts.v2) {
      const doc = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "250000", payTo: PAY_TO, asset: BASE_USDC, maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" } }] };
      return new Response("{}", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(doc)).toString("base64") } });
    }
    return new Response(opts.body ?? v1Body(), { status: opts.status ?? 402, headers: { "content-type": "application/json" } });
  });
  return { transport: transport as unknown as typeof import("@/lib/property/safeFetch").pinnedFetch, seen };
}

async function sign(terms: Pick<CheckoutTerms, "payTo" | "amountAtomic">, over: Partial<Record<"to" | "value" | "validBefore", string>> = {}, signer = payer) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: payer.address,
    to: over.to ?? terms.payTo,
    value: over.value ?? terms.amountAtomic,
    validAfter: String(now - 10),
    validBefore: over.validBefore ?? String(now + 100),
    nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`,
  };
  const signature = await signer.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, from: authorization.from as `0x${string}`, to: authorization.to as `0x${string}`, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce as `0x${string}` },
  });
  return { authorization, signature };
}

beforeEach(() => claimed.clear());

describe("terms come only from the merchant's 402", () => {
  it("parses v1 and v2 into the same terms", async () => {
    const a = await fetchTerms(RESOURCE, merchant().transport);
    const b = await fetchTerms(RESOURCE, merchant({ v2: true }).transport);
    for (const r of [a, b]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toMatchObject({ network: "base", chainId: 8453, payTo: PAY_TO, amountAtomic: "250000", amountUsdc: "0.250000" });
    }
  });

  it("refuses non-https, credentials, private hosts and redirects", async () => {
    expect(checkResource("http://93.184.216.34/x").ok).toBe(false);
    expect(checkResource("https://u:p@93.184.216.34/x").ok).toBe(false);
    expect((await fetchTerms("https://127.0.0.1/x", merchant().transport)).ok).toBe(false);
    expect((await fetchTerms("https://169.254.169.254/latest/meta-data", merchant().transport)).ok).toBe(false);
    const r = await fetchTerms(RESOURCE, merchant({ redirect: true }).transport);
    expect(r.ok).toBe(false);
  });

  it("only pays native USDC with scheme exact", () => {
    const usdt = parseTerms(RESOURCE, 402, new Headers(), v1Body({ asset: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" }));
    expect(usdt.ok).toBe(false);
    if (!usdt.ok) expect(usdt.code).toBe("unsupported_terms");
    const notPay = parseTerms(RESOURCE, 200, new Headers(), "{}");
    expect(!notPay.ok && notPay.code).toBe("not_payment_required");
  });
});

describe("payResource", () => {
  const terms = { payTo: PAY_TO, amountAtomic: "250000" };

  it("delivers a verified payment exactly as signed, and returns the receipt", async () => {
    const m = merchant();
    const signed = await sign(terms);
    const r = await payResource("usr_1", RESOURCE, signed, m.transport);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe(200);
      expect(r.value.receipt).toEqual({ success: true, transaction: "0xabc" });
    }
    const sent = JSON.parse(Buffer.from(m.seen.at(-1)!.headers["X-PAYMENT"], "base64").toString());
    expect(sent.payload.authorization).toEqual(signed.authorization);
    expect(sent.network).toBe("base");
  });

  it("uses the v2 header for v2 merchants", async () => {
    const m = merchant({ v2: true });
    expect((await payResource("usr_1", RESOURCE, await sign(terms), m.transport)).ok).toBe(true);
    expect(m.seen.at(-1)!.headers["PAYMENT-SIGNATURE"]).toBeTruthy();
  });

  it("refuses a modified amount or recipient", async () => {
    const amt = await payResource("usr_1", RESOURCE, await sign(terms, { value: "1" }), merchant().transport);
    expect(!amt.ok && amt.code).toBe("terms_mismatch");
    const to = await payResource("usr_1", RESOURCE, await sign(terms, { to: "0x2222222222222222222222222222222222222222" }), merchant().transport);
    expect(!to.ok && to.code).toBe("terms_mismatch");
  });

  it("refuses a signature from a different key", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const r = await payResource("usr_1", RESOURCE, await sign(terms, {}, other), merchant().transport);
    expect(!r.ok && r.code).toBe("bad_signature");
  });

  it("refuses an expired or over-long authorization", async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = await payResource("usr_1", RESOURCE, await sign(terms, { validBefore: String(now - 1) }), merchant().transport);
    expect(!old.ok && old.code).toBe("expired");
    const long = await payResource("usr_1", RESOURCE, await sign(terms, { validBefore: String(now + 7200) }), merchant().transport);
    expect(!long.ok && long.code).toBe("terms_mismatch");
  });

  it("delivers an authorization once per user (replay refused)", async () => {
    const signed = await sign(terms);
    expect((await payResource("usr_1", RESOURCE, signed, merchant().transport)).ok).toBe(true);
    const again = await payResource("usr_1", RESOURCE, signed, merchant().transport);
    expect(!again.ok && again.code).toBe("replay");
  });

  it("refuses a price above the per-transfer cap", async () => {
    vi.stubEnv("FURLPAY_MAX_TRANSFER_USD", "0.1");
    const r = await payResource("usr_1", RESOURCE, await sign(terms), merchant().transport);
    vi.unstubAllEnvs();
    expect(!r.ok && r.code).toBe("over_limit");
  });
});
