import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  SPENDING_PERIODS,
  computeSpendingSummary,
  isValidTimeZone,
  type SpendingPeriod,
} from "@/lib/spendingSummary";

export const dynamic = "force-dynamic";

// GET /api/summary?period=today|this_week|this_month&tz=Europe/Amsterdam
//
// The caller's own spending rollup. Exists so the Guardian watch apps can answer
// "am I on budget?" without pulling the entire transaction list over a Bluetooth
// relay to sum it on-device — see lib/spendingSummary.ts for why the contract is
// shaped the way it is and why the timezone is the caller's, not the server's.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "summary", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const periodParam = req.nextUrl.searchParams.get("period") ?? "today";
  if (!(SPENDING_PERIODS as readonly string[]).includes(periodParam)) {
    return NextResponse.json(
      { error: "invalid_period", supported: SPENDING_PERIODS },
      { status: 400 }
    );
  }

  // Reject an unknown zone rather than silently falling back to UTC — a wrong
  // "today" is worse than a 400, because the caller can't tell it was wrong.
  const tz = req.nextUrl.searchParams.get("tz") ?? "UTC";
  if (!isValidTimeZone(tz)) {
    return NextResponse.json(
      { error: "invalid_timezone", detail: `'${tz}' is not a known IANA time zone` },
      { status: 400 }
    );
  }

  const summary = computeSpendingSummary(
    auth.account.transactions,
    periodParam as SpendingPeriod,
    Date.now(),
    tz
  );

  return NextResponse.json({ ...summary, timeZone: tz });
}
