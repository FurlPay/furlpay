import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sbSelect: vi.fn(), sbUpdate: vi.fn(), sbRpc: vi.fn(), sbCount: vi.fn(), screen: vi.fn(), createPayment: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbUpdate: h.sbUpdate, sbRpc: h.sbRpc, sbCount: h.sbCount, sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: h.screen }));
vi.mock("@/lib/services/payments", () => ({ createPayment: h.createPayment }));

import { batchFee, quoteBatch, seatFee, unitsToUsd } from "../pricing";
import { createBatch, PayrollConflict, submitBatch, updateContractor } from "../repository";
import { batchSchema, contractorSchema } from "../model";
import { IntegrationNotConfiguredError } from "@/lib/integrations";

const OWNER = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const ADDR = "0x" + "ab".repeat(20);
const contractor = (over = {}) => ({ id: C1, merchant_id: OWNER, name: "Ada", email: "a@b.co", role: "", country: "DE", payout_chain: "arbitrum", payout_address: ADDR, default_amount_units: 2500000000, tax_status: "unsubmitted", active: true, ...over });
const input = { requestId: BATCH, cycle: "2026-10", chain: "arbitrum" as const, lines: [{ contractorId: C1 }] };

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.sbCount.mockResolvedValue(4);
  h.sbRpc.mockResolvedValue({});
  h.sbUpdate.mockResolvedValue([]);
});

describe("payroll pricing (BigInt micro-units)", () => {
  it("charges 35 bps rounded down with a 1.50 USDC floor", () => {
    expect(batchFee(100_000_000n)).toBe(1_500_000n);
    expect(batchFee(10_000_000_000n)).toBe(35_000_000n);
    expect(batchFee(1_000_000_007n)).toBe(3_500_000n);
  });
  it("charges 19 USDC per active contractor once per cycle", () => {
    expect(seatFee(4, false)).toBe(76_000_000n);
    expect(seatFee(4, true)).toBe(0n);
    expect(() => seatFee(-1, false)).toThrow();
  });
  it("totals the quote and refuses out-of-range lines", () => {
    expect(quoteBatch([1_000_000_000n], 1, false)).toEqual({ gross: 1_000_000_000n, batchFee: 3_500_000n, seatFee: 19_000_000n, total: 1_022_500_000n });
    expect(() => quoteBatch([], 1, false)).toThrow();
    expect(() => quoteBatch([0n], 1, false)).toThrow();
    expect(() => quoteBatch([1_000_000_000_001n], 1, false)).toThrow();
  });
  it("converts units to the USD number exactly", () => {
    expect(unitsToUsd(1n)).toBe(0.000001);
    expect(unitsToUsd(123_456_789n)).toBe(123.456789);
    expect(unitsToUsd(1_000_000_000_000n)).toBe(1_000_000);
  });
});

describe("payroll input validation", () => {
  it("never takes a recipient address in a batch: only roster ids", () => {
    expect(batchSchema.safeParse(input).success).toBe(true);
    expect(batchSchema.safeParse({ ...input, lines: [{ contractorId: C1, address: "0x" + "cd".repeat(20) }] }).success).toBe(false);
    expect(batchSchema.safeParse({ ...input, lines: [{ contractorId: C1 }, { contractorId: C1 }] }).success).toBe(false);
    expect(batchSchema.safeParse({ ...input, chain: "ethereum" }).success).toBe(false);
    // FurlPayRouter settles on Arbitrum; any other payout chain would mislabel where funds land.
    expect(batchSchema.safeParse({ ...input, chain: "base" }).success).toBe(false);
    expect(batchSchema.safeParse({ ...input, cycle: "2026-13" }).success).toBe(false);
  });
  it("rejects zero addresses, unbounded amounts and unknown fields on contractors", () => {
    const ok = { requestId: C1, name: "Ada", email: "a@b.co", country: "DE", payoutChain: "arbitrum", payoutAddress: ADDR, defaultAmount: "2500" };
    expect(contractorSchema.safeParse(ok).success).toBe(true);
    expect(contractorSchema.safeParse({ ...ok, payoutAddress: "0x" + "0".repeat(40) }).success).toBe(false);
    expect(contractorSchema.safeParse({ ...ok, defaultAmount: "1000000.000001" }).success).toBe(false);
    expect(contractorSchema.safeParse({ ...ok, tax_status: "w9_signed" }).success).toBe(false);
  });
  it("patches whitelisted columns only, scoped to the owner", async () => {
    h.sbUpdate.mockResolvedValue([contractor()]);
    await updateContractor(OWNER, { id: C1, name: "Ada L" });
    expect(Object.keys(h.sbUpdate.mock.calls[0][2]).sort()).toEqual(["name", "updated_at"]);
    expect(h.sbUpdate.mock.calls[0][1]).toContain(`merchant_id=eq.${OWNER}`);
  });
});

describe("createBatch", () => {
  const roster = (rows: object[]) => h.sbSelect.mockImplementation(async (table: string) => table === "payroll_contractors" ? rows : []);
  it("pays the saved address, screens it, and sends bounded pricing to the database", async () => {
    roster([contractor()]);
    h.screen.mockResolvedValue({ action: "allow", categories: [] });
    await createBatch(OWNER, input);
    const [fn, args] = h.sbRpc.mock.calls[0];
    expect(fn).toBe("payroll_batch_create");
    expect(args).toMatchObject({ p_merchant: OWNER, p_seats: 4, p_batch_bps: 35, p_batch_min_units: "1500000", p_seat_units: "19000000" });
    expect(args.p_lines).toEqual([{ contractor_id: C1, name: "Ada", recipient: ADDR, amount_units: "2500000000", screening: "clear" }]);
  });
  it("marks a recipient blocked on review/block, and unavailable when screening fails", async () => {
    roster([contractor()]);
    h.screen.mockResolvedValueOnce({ action: "review", categories: [] });
    await createBatch(OWNER, input);
    expect(h.sbRpc.mock.calls[0][1].p_lines[0].screening).toBe("blocked");
    h.screen.mockRejectedValueOnce(new Error("circle down"));
    await createBatch(OWNER, input);
    expect(h.sbRpc.mock.calls[1][1].p_lines[0].screening).toBe("unavailable");
  });
  it("refuses unknown, inactive or wrong-chain contractors", async () => {
    roster([]);
    await expect(createBatch(OWNER, input)).rejects.toBeInstanceOf(PayrollConflict);
    roster([contractor({ active: false })]);
    await expect(createBatch(OWNER, input)).rejects.toThrow("inactive");
    roster([contractor({ payout_chain: "polygon" })]);
    await expect(createBatch(OWNER, input)).rejects.toThrow("polygon");
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
});

describe("submitBatch", () => {
  const line = { id: "44444444-4444-4444-8444-444444444444", batch_id: BATCH, name: "Ada", recipient: ADDR, amount_units: 2500000000, screening: "clear", payment_id: null };
  const batch = { id: BATCH, merchant_id: OWNER, cycle: "2026-10", chain: "arbitrum", status: "submitting" };
  const claimable = () => h.sbUpdate.mockImplementation(async (t: string, q: string) => t === "payroll_batches" && q.includes("status=eq.draft") ? [batch] : []);
  beforeEach(() => { h.sbSelect.mockImplementation(async (t: string) => t === "payroll_batch_lines" ? [line] : [{ ...batch, status: "submitted" }]); });

  it("moves draft to submitting by compare-and-set and mints one idempotent intent per line", async () => {
    claimable();
    const signData = { primaryType: "Payment", message: { deadline: 1_900_000_000 } };
    h.createPayment.mockResolvedValue({ record: { id: "pay_1", feeUsdc: 12.5 }, signData });
    await submitBatch(OWNER, BATCH, OWNER);
    expect(h.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500, sourceChain: "arbitrum", recipient: ADDR, idempotencyKey: `payroll:${BATCH}:${line.id}` }));
    // The signing payload is persisted with the line, so a refresh can resume it.
    expect(h.sbUpdate).toHaveBeenCalledWith("payroll_batch_lines", expect.stringContaining(line.id),
      { payment_id: "pay_1", sign_data: signData, sign_deadline: new Date(1_900_000_000_000).toISOString(), issue_count: 1 });
  });
  it("refuses a batch that another request already claimed", async () => {
    await expect(submitBatch(OWNER, BATCH, OWNER)).rejects.toThrow("submitted");
    expect(h.createPayment).not.toHaveBeenCalled();
  });
  it("returns the batch to draft and records nothing when an intent cannot be built", async () => {
    claimable();
    h.createPayment.mockRejectedValue(new IntegrationNotConfiguredError("FurlPayRouter (FURLPAY_ROUTER_ADDRESS)"));
    await expect(submitBatch(OWNER, BATCH, OWNER)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
    expect(h.sbUpdate).toHaveBeenCalledWith("payroll_batches", expect.stringContaining("status=eq.submitting"), { status: "draft" });
    expect(h.sbUpdate.mock.calls.some(c => c[0] === "payroll_batch_lines")).toBe(false);
  });
  it("fails closed in production without a router before touching the batch", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("FURLPAY_ROUTER_ADDRESS", "");
    try { await expect(submitBatch(OWNER, BATCH, OWNER)).rejects.toBeInstanceOf(IntegrationNotConfiguredError); }
    finally { vi.unstubAllEnvs(); }
    expect(h.sbUpdate).not.toHaveBeenCalled();
  });
});
