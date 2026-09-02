import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { resolveInstitution } from "@/lib/markets/institutions";
import { quarterComparison } from "@/lib/markets/providers/thirteenF";
import { rateLimitOr429 } from "@/lib/rateLimit";

const PAGE = 50;
const MAX_PAGE = 250;

// GET /api/markets/institutions/[cik]/changes — what a manager did last quarter.
//
// A single 13F says what was held. This differences two of them, so it says
// what changed. That is the only part of a filing that describes behaviour
// rather than position size, and it is also where filing-derived data is most
// often wrong, so three things are enforced here rather than left to a caller.
//
// The comparison is against an earlier PERIOD, never merely the previous
// filing. An amendment carries the same period end, and differencing it
// measures a correction rather than any trading.
//
// Moves are classified on the SHARE count, not on value. A position's value
// changes when the price changes: ARK held fewer AMD shares at 30 June 2026
// than at 31 March and the line was worth $270m more. Classifying on value
// would report that rally as a purchase.
//
// And a new position has no percentage change. `shareChangePct` is null rather
// than infinite, so a surface has to render "new" instead of a number.
//
// ── ON READING THESE NUMBERS ───────────────────────────────────────────────
//
// The institution's `kind` travels with the response for a reason. A market
// maker's position is inventory from quoting and hedging, sized by order flow
// rather than by a view, and its churn is not accumulation or distribution.
// Measured across Q1 to Q2 2026: Jane Street shows 823 new positions against
// 1,059 exits over 5,048 issuers, while ARK — a concentrated discretionary
// book — moved 188 of 189 issuers but opened only 10 and closed 6. Both are
// "active". Only one of them is expressing a view, and no arithmetic on the
// filing alone can tell you which.
export async function GET(req: NextRequest, props: { params: Promise<{ cik: string }> }) {
  // Two full information tables per uncached request, each up to tens of
  // megabytes from EDGAR. Tighter than the holdings route for that reason.
  const limited = await rateLimitOr429(req, "markets.institution.changes", {
    limit: 15,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const params = await props.params;
  const institution = resolveInstitution(params.cik);
  if (!institution) {
    return NextResponse.json({ error: "Unknown institution" }, { status: 404 });
  }

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? PAGE) || PAGE), MAX_PAGE);
  /** "new" | "added" | "reduced" | "exited" — omit for everything that moved. */
  const kind = url.searchParams.get("kind");

  const cmp = await quarterComparison(institution.cik).catch(() => null);
  // No earlier complete filing means no comparison. A manager's first 13F has
  // no delta, and differencing against an empty quarter would report their
  // entire book as new buying.
  if (!cmp) {
    return NextResponse.json(
      {
        institution,
        comparison: null,
        reason:
          "No earlier complete filing to compare against. A first 13F has no quarter-over-quarter change, and an amendment is not a comparable period.",
        asOf: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  const moved = cmp.deltas.filter((d) => d.kind !== "unchanged");
  const selected = kind ? cmp.deltas.filter((d) => d.kind === kind) : moved;

  return NextResponse.json({
    institution,
    comparison: {
      managerName: cmp.managerName,
      priorPeriod: cmp.priorPeriod,
      currentPeriod: cmp.currentPeriod,
      priorAccession: cmp.priorAccession,
      currentAccession: cmp.currentAccession,
      issuers: cmp.deltas.length,
      moved: moved.length,
      opened: cmp.deltas.filter((d) => d.kind === "new").length,
      closed: cmp.deltas.filter((d) => d.kind === "exited").length,
      added: cmp.deltas.filter((d) => d.kind === "added").length,
      reduced: cmp.deltas.filter((d) => d.kind === "reduced").length,
      /**
       * Share of issuers that were opened or closed rather than resized. High
       * turnover is characteristic of inventory; a concentrated discretionary
       * book resizes far more often than it rotates. This is a description of
       * the filing, not a judgement about the manager.
       */
      rotationPct:
        cmp.deltas.length > 0
          ? ((cmp.deltas.filter((d) => d.kind === "new" || d.kind === "exited").length /
              cmp.deltas.length) *
              100)
          : null,
    },
    changes: selected.slice(offset, offset + limit),
    page: { offset, limit, total: selected.length },
    disclaimer:
      "Changes are computed by differencing two Form 13F filings and describe reported positions only. Form 13F excludes short positions, cash and written options, so a change here is not a change in economic exposure, and the filing does not establish why any position moved.",
    asOf: new Date().toISOString(),
  });
}
