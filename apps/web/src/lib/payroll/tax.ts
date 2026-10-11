import { sbSelect } from "@/lib/supabase";
import { requireStorage } from "./repository";
import type { Batch, BatchLine, Contractor } from "./model";

// 1099-NEC threshold WATCH, not a filing. It totals what each US contractor was
// sent in SUBMITTED payroll batches per calendar year and flags who crosses the
// reporting threshold. It cannot say what actually settled (intents are signed
// by the employer's wallet outside FurlPay), it holds no TINs (W-9 collection is
// not built), and it files nothing with the IRS. Not tax advice.
//
// Thresholds (aggregate per recipient per calendar year), checked 2026-10-09:
//   payments through 2025: $600; payments after 2025-12-31: $2,000 (One Big
//   Beautiful Bill Act); inflation-adjusted from 2027 — not yet published, so
//   2027+ returns no threshold rather than a guess.
export function necThresholdUnits(year: number): bigint | null {
  if (!Number.isInteger(year) || year < 2000) return null;
  if (year <= 2025) return 600_000_000n;
  if (year === 2026) return 2_000_000_000n;
  return null;
}

export type TaxRow = { contractorId: string; name: string; country: string; taxStatus: Contractor["tax_status"]; totalUnits: string; batches: number; overThreshold: boolean | null };

/** Pure aggregation, exported for tests. Only US contractors are 1099 candidates; W-8BEN filers are foreign. */
export function summarize(year: number, contractors: Contractor[], batches: Batch[], lines: BatchLine[]) {
  const threshold = necThresholdUnits(year);
  const inYear = new Map(batches.filter(b => b.status === "submitted" && b.submitted_at && new Date(b.submitted_at).getUTCFullYear() === year).map(b => [b.id, b]));
  const rows: TaxRow[] = [];
  for (const c of contractors.filter(c => c.country === "US")) {
    const mine = lines.filter(l => l.contractor_id === c.id && inYear.has(l.batch_id));
    const total = mine.reduce((s, l) => s + BigInt(String(l.amount_units)), 0n);
    if (total === 0n) continue;
    rows.push({ contractorId: c.id, name: c.name, country: c.country, taxStatus: c.tax_status, totalUnits: total.toString(), batches: new Set(mine.map(l => l.batch_id)).size, overThreshold: threshold === null ? null : total >= threshold });
  }
  rows.sort((a, b) => (BigInt(b.totalUnits) > BigInt(a.totalUnits) ? 1 : -1));
  return { year, thresholdUnits: threshold?.toString() ?? null, basis: "submitted_batches" as const, rows };
}

export async function taxSummary(owner: string, year: number) {
  requireStorage();
  const eq = encodeURIComponent(owner);
  const [contractors, batches] = await Promise.all([
    sbSelect<Contractor>("payroll_contractors", `merchant_id=eq.${eq}&country=eq.US&limit=500`),
    sbSelect<Batch>("payroll_batches", `merchant_id=eq.${eq}&status=eq.submitted&submitted_at=gte.${year}-01-01&submitted_at=lt.${year + 1}-01-01&limit=1000`),
  ]);
  const lines = batches.length ? await sbSelect<BatchLine>("payroll_batch_lines", `batch_id=in.(${batches.map(b => b.id).join(",")})&limit=10000`) : [];
  // A truncated read would understate totals; refuse instead.
  if (batches.length === 1000 || lines.length === 10000) throw new Error("Too many payroll records for one summary");
  return summarize(year, contractors, batches, lines);
}
