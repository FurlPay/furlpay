import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbRpc: vi.fn(), status: "blocked" }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbRpc: h.sbRpc, sbUpdate: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));

import { excludeUnscreened, PayrollConflict } from "../repository";
import { batchActionSchema } from "../model";

const OWNER = "11111111-1111-4111-8111-111111111111", BATCH = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  h.sbRpc.mockReset(); h.sbSelect.mockReset(); h.status = "blocked";
  h.sbSelect.mockImplementation(async (t: string) => t === "payroll_batches" ? [{ id: BATCH, merchant_id: OWNER, status: h.status }] : []);
});

describe("excluding recipients that did not clear screening", () => {
  it("requires a reason and nothing else from the client", () => {
    expect(batchActionSchema.safeParse({ id: BATCH, action: "exclude_unscreened", note: "flagged by OFAC" }).success).toBe(true);
    expect(batchActionSchema.safeParse({ id: BATCH, action: "exclude_unscreened", note: " " }).success).toBe(false);
    expect(batchActionSchema.safeParse({ id: BATCH, action: "exclude_unscreened", note: "ok then", lineIds: [] }).success).toBe(false);
  });
  it("reprices with the server's pricing constants, never the client's", async () => {
    await excludeUnscreened(OWNER, BATCH, "flagged by OFAC");
    expect(h.sbRpc).toHaveBeenCalledWith("payroll_batch_exclude_unscreened", { p_batch: BATCH, p_merchant: OWNER, p_actor: OWNER, p_note: "flagged by OFAC", p_batch_bps: 35, p_batch_min_units: "1500000" });
  });
  it("refuses a batch that is not blocked, and another merchant's batch", async () => {
    h.status = "draft";
    await expect(excludeUnscreened(OWNER, BATCH, "flagged")).rejects.toBeInstanceOf(PayrollConflict);
    h.sbSelect.mockResolvedValue([]);
    expect(await excludeUnscreened(OWNER, BATCH, "flagged")).toBeNull();
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
});
