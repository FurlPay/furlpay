import { describe, expect, it, vi } from "vitest";

// OPT-IN, read-only, against Sui MAINNET GraphQL:  SUI_LIVE=1 npx vitest run sui.live
// Only storage and screening are stubbed; every chain read is real. It replays a
// real USDC payment (+1,462,500 to 0x9f63…4d7f at checkpoint 331902798).
const run = process.env.SUI_LIVE === "1" ? describe : describe.skip;
// The stub returns a full intent row, as merchant_payment_receive does (the verifier keeps scanning with it).
const h = vi.hoisted(() => ({ intent: {} as Record<string, unknown>, sbRpc: vi.fn() }));
h.sbRpc.mockImplementation(async (_f: string, a: Record<string, unknown>) => ({ ...h.intent, status: "paid", received_units: a.p_amount, paid_at: "x" }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbUpdate: vi.fn(async () => []), sbSelect: vi.fn(async () => []), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn(async () => ({ action: "allow", categories: [] })) }));

run("Sui verifier against mainnet", () => {
  it("finds, re-reads and attributes a real USDC payment", async () => {
    const { scanIntent } = await import("../verifier");
    const intent = {
      id: "11111111-1111-4111-8111-111111111111", link_id: "l", merchant_id: "m", chain: "sui", reference: "r",
      recipient: "0x9f63425709069336fec108bd4ba69a8f3d23e8ab237311f3ce58ae2bb0ed4d7f", status: "awaiting_payment",
      gross_units: "1462500", fee_units: "0", charge_units: "1462500", net_units: "1462500", received_units: "0",
      start_block: "331902790", scan_block: "331902790", created_at: "2026-10-09T03:05:00.000Z", expires_at: "2026-10-09T03:08:00.000Z",
      paid_at: null, transaction_hash: null, confirmations: 0, ledger_tx_id: null,
    } as const;
    h.intent = { ...intent };
    await scanIntent({ ...intent });
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_payment_receive", expect.objectContaining({
      p_tx: "4bmJYoQ1K3HSgLq5xRMKNwNfzrcQQc39c7uJgvK2UqH8", p_amount: "1462500", p_block: "331902798",
      p_payer: "0x455a155224ca1795f1cc615ce549e0cb7d6a5176f3a6679bb352e8f82ffe8114", p_block_hash: "2hcjZM1pxWyJd5vKag2nPQg9e9QwTPYZahL7WusHmGaj",
    }));
  }, 60_000);
});
