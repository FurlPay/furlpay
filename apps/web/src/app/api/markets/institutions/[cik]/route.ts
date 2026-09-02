import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { resolveInstitution } from "@/lib/markets/institutions";
import {
  latestThirteenF,
  positionsByIssuer,
  shareTotal,
  reportedTotal,
} from "@/lib/markets/providers/thirteenF";
import { rateLimitOr429 } from "@/lib/rateLimit";

/** Positions per page. A large filer reports thousands of issuers — JPMorgan's
 *  Q2 2026 filing collapses to 4,737 — and serving them in one response is
 *  megabytes nobody reads. */
const PAGE = 50;
const MAX_PAGE = 250;

// GET /api/markets/institutions/[cik] — one manager's latest 13F-HR.
//
// The segment accepts either a registry slug ("berkshire-hathaway") or a CIK in
// any spelling; both resolve to the same filer.
//
// ── WHAT THIS ROUTE REFUSES TO DO ──────────────────────────────────────────
//
// It does not add share values to option notional. It does not report a
// contract count as a share count. It does not describe the filing as current
// when the manager has since filed a notice for a later quarter. Each of those
// is a specific way published 13F summaries go wrong, and each is handled in
// `providers/thirteenF.ts` rather than here — this route's job is to pass the
// distinctions through intact rather than flatten them into one number.
//
// It also does not map a position to a tradable symbol. A 13F identifies
// securities by CUSIP, this app has no CUSIP-to-ticker map, and matching on
// issuer NAME is the defect the provider documents: "RIOT" matches MARRIOTT,
// "MARA" matches MARATHON PETROLEUM. A wrong link from a holdings row to a
// trade ticket is worse than no link, so rows carry their CUSIP and no symbol.
export async function GET(req: NextRequest, props: { params: Promise<{ cik: string }> }) {
  // EDGAR publishes a 10 req/s ceiling for the whole site, and an information
  // table is tens of megabytes. The cache absorbs repeats; this stops one
  // client from walking the registry and spending the budget on its own.
  const limited = await rateLimitOr429(req, "markets.institution", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const params = await props.params;
  const institution = resolveInstitution(params.cik);
  // Only registry filers are served. The provider would happily fetch any CIK,
  // which turns this route into an open proxy onto EDGAR under our User-Agent
  // and our rate limit.
  if (!institution) {
    return NextResponse.json({ error: "Unknown institution" }, { status: 404 });
  }

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const requested = Number(url.searchParams.get("limit") ?? PAGE) || PAGE;
  const limit = Math.min(Math.max(1, requested), MAX_PAGE);

  const filing = await latestThirteenF(institution.cik).catch(() => null);
  // A registry entry with no readable filing is a real answer, not an error to
  // paper over: EDGAR may be down, or the manager may have stopped filing since
  // the registry was checked. Either way there are no holdings to show.
  if (!filing) {
    return NextResponse.json(
      {
        institution,
        filing: null,
        reason:
          "No 13F-HR could be read for this filer. It may have stopped filing, or EDGAR may be unavailable.",
        asOf: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  const positions = positionsByIssuer(filing.holdings);
  const page = positions.slice(offset, offset + limit);

  // Two totals, never one. `shareValue` is what a reader means by "holdings";
  // `reported` is the filer's own tableValueTotal and includes option notional.
  // Quoting the second as the first is how a book gets overstated by billions.
  const shares = shareTotal(filing.holdings);
  const reported = reportedTotal(filing.holdings);

  return NextResponse.json({
    institution,
    filing: {
      managerName: filing.managerName,
      cik: filing.cik,
      periodOfReport: filing.periodOfReport,
      filedAt: filing.filedAt,
      accession: filing.accession,
      sourceUrl: filing.sourceUrl,
      /** Rows in the information table, as filed. */
      entries: filing.reportedEntryTotal,
      /** Distinct issuers after options are folded onto their underlying. */
      issuers: positions.length,
      shareValueTotal: shares,
      reportedValueTotal: reported,
      /** The filer's own stated total, for comparison with ours. */
      filerReportedValueTotal: filing.reportedValueTotal,
      /**
       * Did our parse reproduce the filer's own totals exactly? When false,
       * the numbers here disagree with the source and a surface should say so
       * rather than render them as fact.
       */
      reconciled: filing.reconciled,
      /**
       * Managers rolled into this report. A large filer submits a combination
       * report covering many included managers, so the total is a sum across a
       * structure, not one desk's book.
       */
      otherIncludedManagers: filing.otherIncludedManagers,
      /**
       * Non-null when this manager has since filed a 13F-NT for a LATER
       * quarter — the holdings below are not their most recent word.
       */
      supersededBy: filing.supersededBy,
      /** The form actually served, and whether it is itself a restatement. */
      form: filing.form,
      isAmendment: filing.isAmendment,
      amendmentNo: filing.amendmentNo,
      /**
       * The filer states this report omits positions under confidential
       * treatment. The filing is incomplete by design and its totals are not
       * the whole book.
       */
      confidentialOmitted: filing.confidentialOmitted,
      /**
       * Amendments filed after this report that ADD holdings rather than
       * restate them — usually positions released from confidential treatment.
       * Deliberately not merged into the totals: a merged figure would be ours
       * rather than the filer's, and would break reconciliation against the
       * source.
       */
      partialAmendments: filing.partialAmendments,
    },
    positions: page.map((p) => ({
      issuer: p.issuer,
      cusip: p.cusip,
      cusip6: p.cusip6,
      shareValue: p.shareValue,
      shares: p.shares,
      // Derivatives, reported at the notional value of the underlying and
      // counted in CONTRACTS. Kept in their own fields so no caller can add
      // them to the share line by accident.
      callValue: p.callValue,
      callContracts: p.callContracts,
      putValue: p.putValue,
      putContracts: p.putContracts,
      /** This issuer's share of the share-only total, or null when there is
       *  nothing to divide by. Never a zero standing in for "unknown". */
      shareOfPortfolioPct: shares > 0 ? (p.shareValue / shares) * 100 : null,
    })),
    page: { offset, limit, total: positions.length },
    // What a 13F is, carried with the data rather than left to the caller to
    // remember. Long US-listed positions only; no shorts, cash, bonds or
    // non-US listings; filed up to 45 days after the quarter it describes.
    // The SEC does not verify these filings — the language is "the filing
    // reports", never "the SEC confirms".
    disclaimer:
      "Form 13F reports long positions in US-listed securities held at quarter end, filed up to 45 days later. It excludes short positions, cash, bonds and non-US listings. The SEC does not verify these filings.",
    asOf: new Date().toISOString(),
  });
}
