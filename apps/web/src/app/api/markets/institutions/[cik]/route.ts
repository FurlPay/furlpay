import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { resolveInstitution } from "@/lib/markets/institutions";
import {
  latestThirteenF,
  positionsByIssuer,
  shareTotal,
  debtTotal,
  optionTotals,
  reportedTotal,
} from "@/lib/markets/providers/thirteenF";
import { enrichPositions, marketDataTargetFor } from "@/lib/markets/positionIdentity";
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
// It does not add share values to option values. It does not describe an
// option row's underlying-share count as a share position. It does not describe the filing as current
// when the manager has since filed a notice for a later quarter. Each of those
// is a specific way published 13F summaries go wrong, and each is handled in
// `providers/thirteenF.ts` rather than here — this route's job is to pass the
// distinctions through intact rather than flatten them into one number.
//
// It maps a position to a ticker through IDENTIFIERS ONLY. The CUSIP (or the
// debt CUSIP, for a debt-only line) goes to OpenFIGI; an issuer name never
// does. Name matching is the defect the provider documents -- "RIOT" matches
// MARRIOTT, "MARA" matches MARATHON PETROLEUM -- and a wrong link from a
// holdings row to a trade ticket is worse than no link. An unresolved security
// carries `ticker: null` rather than a guess.
//
// A position built only from option rows resolves to nothing. Option CUSIPs are
// constructed from the underlying's, so borrowing the prefix would report a
// share position the filing does not contain.
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
  // Identity is resolved for the PAGE, not the filing. A large filer reports
  // thousands of issuers and enriching all of them would spend hundreds of
  // upstream requests to render fifty rows.
  const page = await enrichPositions(positions.slice(offset, offset + limit));

  // Two totals, never one. `shareValue` is what a reader means by "holdings";
  // `reported` is the filer's own tableValueTotal and includes option notional.
  // Quoting the second as the first is how a book gets overstated by billions.
  const shares = shareTotal(filing.holdings);
  const debt = debtTotal(filing.holdings);
  const options = optionTotals(filing.holdings);
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
      // The four buckets every row falls into, and they sum to the filer's own
      // total exactly. Serving them separately is what stops a caller inventing
      // an "exposure" figure by adding whichever two look additive.
      shareValueTotal: shares,
      debtValueTotal: debt,
      callValueTotal: options.callValue,
      putValueTotal: options.putValue,
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
      /**
       * How the filing denominated its value column. Every money figure on
       * this response is whole dollars either way — a "thousands" filing has
       * already been restated — but the unit is sent so a surface can say the
       * number was converted rather than read as filed.
       */
      valueUnit: filing.valueUnit,
      medianPricePerShare: filing.medianPricePerShare,
    },
    positions: page.map((p) => ({
      issuer: p.issuer,
      cusip: p.cusip,
      cusip6: p.cusip6,
      /** Canonical identity, resolved from an identifier and never a name. */
      ticker: p.ticker,
      instrumentType: p.instrumentType,
      figi: p.figi,
      /** Which line the identity came from, and which identifier type resolved
       *  it. "none" means an options-only position, which has no identity of
       *  its own by design. */
      identityBasis: p.identityBasis,
      resolvedVia: p.resolvedVia,
      /** What the next stage should ask the market-data provider for, or null
       *  when this position is not something to price as an equity. */
      marketData: marketDataTargetFor(p),
      shareValue: p.shareValue,
      shares: p.shares,
      // Convertible debt on the same issuer. `debtPrincipal` is a principal
      // amount in dollars, NOT a share count — never add it to `shares`.
      debtValue: p.debtValue,
      debtPrincipal: p.debtPrincipal,
      // Long options. An option row reports the UNDERLYING security, so these
      // are counts of underlying shares at the quarter-end price -- not
      // contracts, and not the premium paid. Kept in their own fields so no
      // caller can add them to the share line by accident: a right over shares
      // is not ownership of them. Written options are not reportable, so these
      // are long-only and cannot be netted into a position.
      callValue: p.callValue,
      callShares: p.callShares,
      putValue: p.putValue,
      putShares: p.putShares,
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
