import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ sbSelect: vi.fn(), sbUpdate: vi.fn(), sbRpc: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
import { necThresholdUnits, summarize } from "../tax";
import type { Batch, BatchLine, Contractor } from "../model";

const c = (id: string, country: string) => ({ id, name: id, country, tax_status: "unsubmitted" }) as Contractor;
const b = (id: string, status: Batch["status"], at: string | null) => ({ id, status, submitted_at: at }) as Batch;
const l = (batch: string, contractor: string, units: string) => ({ batch_id: batch, contractor_id: contractor, amount_units: units }) as BatchLine;

describe("1099-NEC threshold watch", () => {
  it("uses $600 through 2025, $2,000 for 2026, and no guess after", () => {
    expect(necThresholdUnits(2025)).toBe(600_000_000n);
    expect(necThresholdUnits(2026)).toBe(2_000_000_000n);
    expect(necThresholdUnits(2027)).toBeNull();
  });
  it("totals submitted batches in the year for US contractors only", () => {
    const out = summarize(2026, [c("us1", "US"), c("us2", "US"), c("de", "DE")],
      [b("b1", "submitted", "2026-03-01T00:00:00Z"), b("b2", "submitted", "2026-04-01T00:00:00Z"), b("b3", "draft", null), b("b4", "submitted", "2025-12-31T23:00:00Z")],
      [l("b1", "us1", "1500000000"), l("b2", "us1", "500000000"), l("b1", "us2", "1999999999"), l("b3", "us2", "5000000000"), l("b4", "us2", "5000000000"), l("b1", "de", "9000000000")]);
    expect(out.rows).toEqual([
      expect.objectContaining({ contractorId: "us1", totalUnits: "2000000000", batches: 2, overThreshold: true }),
      expect.objectContaining({ contractorId: "us2", totalUnits: "1999999999", batches: 1, overThreshold: false }),
    ]);
    expect(out.basis).toBe("submitted_batches");
  });
  it("reports totals without a verdict when the threshold is unpublished", () => {
    const out = summarize(2027, [c("us1", "US")], [b("b1", "submitted", "2027-01-05T00:00:00Z")], [l("b1", "us1", "9000000000")]);
    expect(out.thresholdUnits).toBeNull();
    expect(out.rows[0].overThreshold).toBeNull();
  });
});
