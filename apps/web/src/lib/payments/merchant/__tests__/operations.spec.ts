import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbInsert: vi.fn(), sbUpdate: vi.fn(), sbUpsert: vi.fn(), sbInsertIgnoreDuplicates: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ ...h, sbRpc: vi.fn(), supabaseBackend: "supabase" }));

import { applyOperation, operationSchema } from "../operations";
import { createLink, processingBps } from "../repository";
import { PRICING } from "../money";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { for (const f of Object.values(h)) f.mockReset(); h.sbInsert.mockResolvedValue([{}]); h.sbUpdate.mockResolvedValue([{}]); h.sbUpsert.mockResolvedValue([{}]); });

describe("merchant operations console", () => {
  it("has no action that credits, releases or refunds", () => {
    for (const action of ["force_complete", "release", "refund", "credit", "set_status"]) expect(operationSchema.safeParse({ action, intentId: ID, note: "please do it" }).success).toBe(false);
    expect(operationSchema.safeParse({ action: "note", intentId: ID, decision: "refund_requested", note: "customer overpaid" }).success).toBe(true);
    expect(operationSchema.safeParse({ action: "note", intentId: ID, decision: "cleared", note: "customer overpaid" }).success).toBe(false);
  });
  it("records a note without touching the intent", async () => {
    h.sbSelect.mockResolvedValue([{ id: ID }]);
    await applyOperation("op-1", { action: "note", intentId: ID, decision: "confirmed_hold", note: "flagged payer" });
    expect(h.sbInsert).toHaveBeenCalledWith("merchant_review_notes", { intent_id: ID, author: "op-1", decision: "confirmed_hold", note: "flagged payer" });
    expect(h.sbUpdate).not.toHaveBeenCalled();
  });
  it("resolves only open alerts and records who and why", async () => {
    await applyOperation("op-1", { action: "resolve_alert", alertId: 7, note: "RPC recovered" });
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_reconciliation_alerts", "id=eq.7&resolved_at=is.null", expect.objectContaining({ resolved_by: "op-1", resolution: "RPC recovered" }));
  });
  it("assigns the tier's rate, never a client-supplied one", async () => {
    expect(operationSchema.safeParse({ action: "set_pricing", merchantId: ID, tier: "enterprise", note: "signed MSA", processing_bps: 1 }).success).toBe(false);
    await applyOperation("admin", { action: "set_pricing", merchantId: ID, tier: "enterprise", note: "signed MSA" });
    expect(h.sbUpsert).toHaveBeenCalledWith("merchant_pricing", expect.objectContaining({ merchant_id: ID, tier: "enterprise", processing_bps: 35 }));
  });
});

describe("pricing tiers", () => {
  it("are 95/75/50/35 bps and default to growth", async () => {
    expect(PRICING).toEqual({ starter: 95, growth: 75, scale: 50, enterprise: 35 });
    h.sbSelect.mockResolvedValue([]);
    expect(await processingBps(ID)).toBe(75);
    h.sbSelect.mockResolvedValue([{ processing_bps: 35 }]);
    expect(await processingBps(ID)).toBe(35);
  });
  it("stamps the merchant's rate on a new link", async () => {
    let saved: Record<string, unknown> | undefined;
    h.sbInsertIgnoreDuplicates.mockImplementation(async (_t: string, row: Record<string, unknown>) => { saved = row; });
    h.sbSelect.mockImplementation(async (table: string) => table === "merchant_pricing" ? [{ processing_bps: 50 }] : saved ? [saved] : []);
    const link = await createLink(ID, "Shop", { requestId: ID, title: "Order", description: "", amount: "100", chains: ["base"], reusable: true, feePayer: "merchant", expiresAt: null, kind: "link", reference: "", lines: [] });
    expect(link.processing_bps).toBe(50);
  });
});
