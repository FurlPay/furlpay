import { FileText } from "lucide-react";
import { DASH, fmtDate } from "./format";

// Attribution for the numbers above it: which upstream produced them, the
// fiscal period the filed figures cover, whether they are a true trailing
// twelve months or a single fiscal year, and a link to the filings themselves.
//
// This is not a footer detail. Every statistic on this page used to be derived
// from a hash of the ticker string, and the reason that survived is that a
// number on a dark background with a monospace font is indistinguishable from
// a checked one. Naming the source and the period is what makes the claim
// falsifiable — a reader who doubts the P/E can open EDGAR and settle it.
//
// The basis label matters as much as the source. "TTM" and "FY2025" are
// different claims about the same company, and a bank that stopped tagging
// quarterly revenue gets the second one; presenting it unlabelled beside a
// live price would imply a currency the figure does not have.

export interface ProvenanceData {
  price: "yahoo" | null;
  fundamentals: "sec-edgar" | null;
  crypto: "coingecko" | null;
  fiscalAsOf: string | null;
  incomeBasis: "ttm" | "annual" | null;
  cik: string | null;
}

const PRICE_SOURCE: Record<string, string> = { yahoo: "Yahoo Finance" };

export default function Provenance({ data }: { data: ProvenanceData }) {
  const { price, fundamentals, crypto, fiscalAsOf, incomeBasis, cik } = data;
  if (!price && !fundamentals && !crypto) return null;

  const basisLabel =
    incomeBasis === "ttm"
      ? "trailing twelve months"
      : incomeBasis === "annual"
        ? "last full fiscal year"
        : null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-textMuted">
        Where these numbers come from
      </p>
      <dl className="mt-2 space-y-1.5 text-[11.5px]">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-textMuted">Price &amp; range</dt>
          <dd className="text-right text-textSecondary">
            {price ? PRICE_SOURCE[price] : DASH}
          </dd>
        </div>
        {crypto ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-textMuted">Supply &amp; market cap</dt>
            <dd className="text-right text-textSecondary">CoinGecko</dd>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-textMuted">Fundamentals</dt>
            <dd className="text-right text-textSecondary">
              {fundamentals ? "SEC EDGAR company filings" : "Not filed with the SEC"}
            </dd>
          </div>
        )}
        {fundamentals && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-textMuted">Period covered</dt>
            <dd className="text-right font-mono text-textSecondary">
              {fmtDate(fiscalAsOf)}
              {basisLabel && (
                <span className="ml-1 font-sans text-textMuted">({basisLabel})</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {cik && (
        <a
          href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-&dateb=&owner=include&count=10`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-accent"
        >
          <FileText className="h-3.5 w-3.5" /> Read the filings on EDGAR
        </a>
      )}
    </div>
  );
}
