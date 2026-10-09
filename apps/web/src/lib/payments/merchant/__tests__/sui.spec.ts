import { beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";

const h = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), sbRpc: vi.fn(), sbUpdate: vi.fn(async (..._a: unknown[]) => [] as unknown[]) }));
vi.mock("../sui", async (orig) => ({ ...(await orig<object>()), suiTransactionsTo: h.list, fetchSuiTransaction: h.get, verifySuiChain: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbUpdate: h.sbUpdate, sbSelect: vi.fn(async () => []), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn(async () => ({ action: "allow", categories: [] })) }));

import { ed25519SuiAddress, isSuiAddress, personalMessageDigest, SUI_USDC, usdcDelta, verifySuiPersonalMessage, type SuiTransaction } from "../sui";
import { scanIntent } from "../verifier";
import { paymentUri } from "../qr";
import { paymentChain, requiredConfirmations } from "../registry";
import type { MerchantIntent } from "../model";

// A real mainnet USDC payment, read from Sui GraphQL on 2026-10-09:
// +1,462,500 micro-USDC to 0x9f63…4d7f, sender 0x455a…8114, checkpoint 331902798.
const REAL: SuiTransaction = {"digest":"4bmJYoQ1K3HSgLq5xRMKNwNfzrcQQc39c7uJgvK2UqH8","sender":{"address":"0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114"},"effects":{"status":"SUCCESS","timestamp":"2026-10-09T03:07:33.200Z","checkpoint":{"sequenceNumber":331902798,"digest":"2hcjZM1pxWyJd5vKag2nPQg9e9QwTPYZahL7WusHmGaj"},"balanceChanges":{"nodes":[{"owner":{"address":"0x1fb0c0a6790860fc83c8f26f6fa089868ad94de9468348f98dfb4cdf89a53777"},"coinType":{"repr":"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"},"amount":"37500"},{"owner":{"address":"0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114"},"coinType":{"repr":"0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI"},"amount":"-4796582"},{"owner":{"address":"0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114"},"coinType":{"repr":"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"},"amount":"-299982129"},{"owner":{"address":"0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114"},"coinType":{"repr":"0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP"},"amount":"14650925968"},{"owner":{"address":"0x9f63425709069336fec108bd4ba69a8f3d23e8ab237311f3ce58ae2bb0ed4d7f"},"coinType":{"repr":"0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"},"amount":"1462500"}],"pageInfo":{"hasNextPage":false}}}};
const RECIPIENT = "0x9f63425709069336fec108bd4ba69a8f3d23e8ab237311f3ce58ae2bb0ed4d7f";
const SENDER = "0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114";
const intent = (over: Partial<MerchantIntent> = {}): MerchantIntent => ({
  id: "11111111-1111-4111-8111-111111111111", link_id: "l", merchant_id: "m", chain: "sui", recipient: RECIPIENT, reference: "r",
  status: "awaiting_payment", gross_units: "1462500", fee_units: "10968", charge_units: "1462500", net_units: "1451532", received_units: "0",
  start_block: "331902700", scan_block: "331902700", created_at: "2026-10-09T03:00:00.000Z", expires_at: "2026-10-09T03:30:00.000Z",
  paid_at: null, transaction_hash: null, confirmations: 0, ledger_tx_id: null, ...over,
});
const clone = (): SuiTransaction => JSON.parse(JSON.stringify(REAL));

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.sbUpdate.mockImplementation(async () => []);
  h.sbRpc.mockImplementation(async (_f: string, a: Record<string, unknown>) => ({ ...intent(), status: "paid", received_units: a.p_amount }));
});

describe("Sui cryptography", () => {
  it("derives a real mainnet sender's address from its Ed25519 key", () => {
    // From mainnet transaction YLqpHTM3Fp4KxgZhqzyZyhG3wLYJMFEGQjJLqWTRjW4.
    expect(ed25519SuiAddress(Buffer.from("5647ec4c7a4fca93efa02984c1be90048d99dc40b88028b6df9040544caabb1e", "hex"))).toBe("0xfc156f6dfaa45ad929b829ac946aaff00bd64799d921a28711ffc81f1ddbcd6a");
  });
  it("verifies a personal-message signature and rejects a wrong message, key or scheme", () => {
    const kp = nacl.sign.keyPair();
    const address = ed25519SuiAddress(kp.publicKey);
    const sign = (msg: string) => Buffer.from([0, ...nacl.sign.detached(personalMessageDigest(new TextEncoder().encode(msg)), kp.secretKey), ...kp.publicKey]).toString("base64");
    expect(verifySuiPersonalMessage(address, "register", sign("register"))).toBe(true);
    expect(verifySuiPersonalMessage(address, "register", sign("other"))).toBe(false);
    expect(verifySuiPersonalMessage(ed25519SuiAddress(nacl.sign.keyPair().publicKey), "register", sign("register"))).toBe(false);
    const secp = Buffer.from(sign("register"), "base64"); secp[0] = 1;
    expect(verifySuiPersonalMessage(address, "register", secp.toString("base64"))).toBe(false);
  });
  it("accepts only full lowercase addresses and uses Circle's coin type", () => {
    expect(isSuiAddress(RECIPIENT)).toBe(true);
    expect(isSuiAddress(RECIPIENT.toUpperCase().replace("0X", "0x"))).toBe(false);
    expect(isSuiAddress("0x2")).toBe(false);
    expect(isSuiAddress("0x" + "0".repeat(64))).toBe(false);
    expect(paymentChain("sui").token).toBe(SUI_USDC);
    expect(SUI_USDC).not.toContain("5523876882a45392702f966e0932f4c6c5d33f0");
  });
  it("nets USDC per owner from real balance changes", () => {
    expect(usdcDelta(REAL, RECIPIENT)).toBe(1_462_500n);
    expect(usdcDelta(REAL, SENDER)).toBe(-299_982_129n);
  });
});

describe("Sui checkout", () => {
  it("is collected at one checkpoint (certified checkpoints are final)", () => {
    expect(requiredConfirmations("sui")).toBe(1);
  });
  it("puts the bare address in the QR: Sui has no payment-request URI standard", () => {
    expect(paymentUri("sui", RECIPIENT, "1462500", "ref")).toBe(RECIPIENT);
    expect(() => paymentUri("sui", "0xabc", "1", "ref")).toThrow();
  });
});

describe("Sui verifier on a real payment", () => {
  it("credits the netted USDC with the sender as payer, checkpoint digest as anchor", async () => {
    h.list.mockResolvedValue([clone()]); h.get.mockResolvedValue(clone());
    await scanIntent(intent());
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_payment_receive", { p_id: intent().id, p_tx: REAL.digest, p_log: 0, p_amount: "1462500", p_payer: SENDER, p_block: "331902798", p_block_hash: "2hcjZM1pxWyJd5vKag2nPQg9e9QwTPYZahL7WusHmGaj", p_time: "2026-10-09T03:07:33.200Z", p_confirmations: 1 });
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_payment_intents", expect.stringContaining("scan_block=eq.331902700"), { scan_block: "331902799" });
  });
  it("ignores transfers before the reservation checkpoint and failed transactions", async () => {
    const failed = clone(); failed.effects.status = "FAILURE";
    h.list.mockResolvedValue([clone(), failed]);
    await scanIntent(intent({ start_block: "331902799", scan_block: "331902700" }));
    h.list.mockResolvedValue([failed]);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("holds a payment outside the checkout window for review instead of crediting", async () => {
    h.list.mockResolvedValue([clone()]); h.get.mockResolvedValue(clone());
    await scanIntent(intent({ created_at: "2026-10-09T03:10:00.000Z" }));
    expect(h.sbRpc).not.toHaveBeenCalled();
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_payment_intents", expect.stringContaining("paid_at=is.null"), { status: "review" });
  });
  it("holds a credit with no attributable payer (sender's USDC did not go down)", async () => {
    const pooled = clone(); pooled.effects.balanceChanges.nodes = pooled.effects.balanceChanges.nodes.filter(b => b.owner?.address !== SENDER);
    h.list.mockResolvedValue([pooled]); h.get.mockResolvedValue(pooled);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalled();
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_payment_intents", expect.anything(), { status: "review" });
  });
  it("refuses when the re-read disagrees with the listing", async () => {
    const other = clone(); other.effects.checkpoint!.digest = "11111111111111111111111111111111";
    h.list.mockResolvedValue([clone()]); h.get.mockResolvedValue(other);
    await expect(scanIntent(intent())).rejects.toThrow("Sui transaction mismatch");
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
});
