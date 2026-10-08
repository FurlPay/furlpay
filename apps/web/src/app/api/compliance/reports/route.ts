import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { listStates, OnboardingUnavailable } from "@/lib/settlement/onboardingStore";
import { CaseStoreUnavailable, listCases } from "@/lib/compliance/caseStore";
import { auditTrailReport, casesReport, investigatorReport, kybReport, monitoringReport, REPORT_TYPES, screeningReport } from "@/lib/compliance/reports";

// GET /api/compliance/reports?type=<report>&from=<iso>&to=<iso> — CSV export
// from stored records, compliance officers only. Every export is audited.
// Columns exclude DOB, email, phone, ID numbers and documents by construction.
export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ type: z.enum(REPORT_TYPES), from: day.optional(), to: day.optional() }).strict();

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.reports", { limit: 20, windowMs: 60_000 }, me);
  if (limited) return limited;
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report request" }, { status: 400 });
  const { type, from, to } = parsed.data;
  // Dates are whole UTC days; `to` is inclusive for the user, exclusive internally.
  const range = { from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString() : undefined };
  try {
    let csv: string;
    if (type === "sanctions_screening" || type === "kyb_reviews") {
      const states = await listStates(500);
      csv = type === "sanctions_screening" ? screeningReport(states, range) : kybReport(states, range);
    } else {
      const cases = await listCases({ limit: 500 });
      csv = type === "cases" ? casesReport(cases, range) : type === "case_audit_trail" ? auditTrailReport(cases, range) : type === "monitoring_alerts" ? monitoringReport(cases, range) : investigatorReport(cases, range);
    }
    const rows = Math.max(0, csv.split("\r\n").length - 2);
    audit("compliance.report_exported", me, { type, from: from ?? null, to: to ?? null, rows });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="furlpay-${type}-${from ?? "all"}-${to ?? "now"}.csv"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof CaseStoreUnavailable || e instanceof OnboardingUnavailable ? e.message : "Report unavailable" }, { status: 503 });
  }
}
