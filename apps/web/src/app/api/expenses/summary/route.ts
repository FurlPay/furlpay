import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { summarizePeriod, summarizeTravel, isPeriod } from "@/lib/expenses/periods";
import { listTrips } from "@/lib/travel/store";
import type { PeriodSummary, TravelSummary } from "@/lib/expenses/periods";

export const dynamic = "force-dynamic";

// GET /api/expenses/summary?period=week|month|year
//
// One period-bucketed view of the acting user's outflow — overall and travel —
// for the terminal dashboard. Read-only.
//
// SCOPING: `auth.account.transactions` and `listTrips(userId)` are both
// user-scoped. This route deliberately does NOT call buildSpendingSummary(),
// which reads the process-global `db.transactions` and would report every
// user's spending to whoever asked.
//
// Travel is aggregated from TRIPS, not transactions: TxCategory has no "travel"
// member, so filtering transactions by category would return an empty report
// forever and look like the user simply had no trips.

export interface ExpenseSummaryResponse {
  period: "week" | "month" | "year";
  overall: PeriodSummary;
  travel: TravelSummary;
  /** Server clock at aggregation time, so the client can show "as of". */
  asOf: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const raw = req.nextUrl.searchParams.get("period") ?? "month";
  if (!isPeriod(raw)) {
    return NextResponse.json(
      { error: "invalid_period", detail: "period must be week, month or year." },
      { status: 400 }
    );
  }

  const now = new Date();
  const transactions = auth.account.transactions ?? [];
  const trips = listTrips(auth.account.user.id);

  const body: ExpenseSummaryResponse = {
    period: raw,
    overall: summarizePeriod(transactions, raw, now),
    travel: summarizeTravel(trips, raw, now),
    asOf: now.toISOString(),
  };

  return NextResponse.json(body);
}
