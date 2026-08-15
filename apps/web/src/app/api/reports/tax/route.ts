import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { buildTaxCsv } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

// GET /api/reports/tax?year=2026&format=csv — realized disposal events
// (Form-8949 style) as a downloadable CSV, or JSON when format=json.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "reports.tax", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const yearParam = p.get("year");
  const year = yearParam ? Number(yearParam) : undefined;
  const format = p.get("format") ?? "csv";

  const csv = buildTaxCsv(Number.isFinite(year) ? year : undefined);

  if (format === "json") {
    return NextResponse.json({ year: year ?? "all", csv });
  }

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="furlpay-tax-${year ?? "all"}.csv"`,
    },
  });
}
