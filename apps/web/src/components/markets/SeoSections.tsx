import Link from "next/link";
import type { MergedAsset } from "@/lib/markets/universe";
import type { RealStats } from "@/lib/markets/providers";
import {
  buildFaq,
  buildHowToBuyFaq,
  entityLabel,
  exchangeLabel,
  howToBuySteps,
  overviewSentence,
  pageH1,
} from "@/lib/markets/seo";
import { DASH, fmtCountCompact, fmtMoneyCompact, fmtMultiple, fmtPct, fmtPerShare } from "./format";

// Server-rendered content for /markets/[symbol].
//
// This is a SERVER component on purpose. Everything above it on the page — the
// chart, the trade ticket, the live quote — is client-side and arrives after
// hydration, which means a crawler previously received a spinner and an empty
// <div> for all ~13,000 ticker pages. Every fact Google should be able to read
// lives here, in the initial HTML.
//
// It is also the page's only <h1>. The interactive header above renders the
// ticker as a <p>, so the document has exactly one.
//
// Nothing here is written by a language model and nothing is templated around a
// value that may be missing: rows whose figure is null are dropped rather than
// printed as "N/A", and a section with no surviving rows does not render.

export default function SeoSections({
  asset,
  stats,
  related,
}: {
  asset: MergedAsset;
  stats: RealStats | null;
  related: { symbol: string; name: string }[];
}) {
  // The visible FAQ and the FAQPage JSON-LD must be the same list — the page
  // builds it the same way page.tsx does, so the two cannot drift apart.
  const faq = [...buildFaq(asset, stats), ...buildHowToBuyFaq(asset)];
  const ex = exchangeLabel(asset);
  const isStock = asset.kind !== "crypto";

  const valuation = rows([
    ["Market cap", fmtMoneyCompact(stats?.marketCap ?? null)],
    ["Enterprise value", fmtMoneyCompact(stats?.enterpriseValue ?? null)],
    ["P/E ratio", fmtMultiple(stats?.peRatio ?? null)],
    ["Price / sales", fmtMultiple(stats?.priceToSales ?? null)],
    ["Price / book", fmtMultiple(stats?.priceToBook ?? null)],
    ["Beta", fmtMultiple(stats?.beta ?? null)],
  ]);

  const financials = rows([
    ["Revenue (TTM)", fmtMoneyCompact(stats?.revenueTtm ?? null)],
    ["Net income (TTM)", fmtMoneyCompact(stats?.netIncomeTtm ?? null)],
    ["EPS (TTM)", fmtPerShare(stats?.epsTtm ?? null)],
    ["Gross margin", stats?.grossMarginPct == null ? DASH : fmtPct(stats.grossMarginPct)],
    ["Operating margin", stats?.operatingMarginPct == null ? DASH : fmtPct(stats.operatingMarginPct)],
    ["Return on equity", stats?.roePct == null ? DASH : fmtPct(stats.roePct)],
    ["Cash", fmtMoneyCompact(stats?.cash ?? null)],
  ]);

  const trading = rows([
    ["52-week high", stats?.high52w == null ? DASH : fmtPerShare(stats.high52w)],
    ["52-week low", stats?.low52w == null ? DASH : fmtPerShare(stats.low52w)],
    ["Volume", fmtCountCompact(stats?.volume ?? null)],
    ["Average volume", fmtCountCompact(stats?.avgVolume ?? null)],
    ["Previous close", stats?.previousClose == null ? DASH : fmtPerShare(stats.previousClose)],
  ]);

  const dividend = rows([
    ["Dividend yield", stats?.dividendYieldPct == null ? DASH : fmtPct(stats.dividendYieldPct)],
    ["Dividend per share (TTM)", fmtPerShare(stats?.dividendPerShareTtm ?? null)],
    ["Payout ratio", stats?.payoutRatioPct == null ? DASH : fmtPct(stats.payoutRatioPct)],
  ]);

  return (
    <div className="mt-10 space-y-10 border-t border-white/[0.07] pt-8">
      {/* Breadcrumb. Real links, so the trail is crawlable rather than
          decorative — the JSON-LD alongside it describes these same anchors. */}
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-textSecondary">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-textPrimary hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/markets" className="hover:text-textPrimary hover:underline">
              Markets
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-textPrimary">{asset.name}</li>
        </ol>
      </nav>

      <section>
        <h1 className="text-[26px] font-bold tracking-tight">{pageH1(asset)}</h1>

        {stats?.price != null && (
          <p className="mt-3 max-w-[72ch] text-[14.5px] leading-relaxed text-textSecondary">
            {entityLabel(asset)} last traded at{" "}
            <strong className="text-textPrimary">{fmtPerShare(stats.price)}</strong>
            {stats.changePct != null && (
              <>
                , {stats.changePct >= 0 ? "up" : "down"}{" "}
                <span className={stats.changePct >= 0 ? "text-gain" : "text-loss"}>
                  {Math.abs(stats.changePct).toFixed(2)}%
                </span>{" "}
                on the session
              </>
            )}
            . The quote above updates while this page is open; the figures below are drawn from{" "}
            {asset.name}&rsquo;s own filings and are restated only when a new one is published.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-[19px] font-bold tracking-tight">
          {asset.name} ({asset.symbol}) company overview
        </h2>
        <p className="mt-2.5 max-w-[72ch] text-[14.5px] leading-relaxed text-textSecondary">
          {overviewSentence(asset, stats)}
        </p>
        {(asset.sector || asset.industry) && (
          <p className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
            {asset.sector && (
              <Link
                href="/markets"
                className="rounded-full border border-white/[0.08] px-3 py-1 text-textSecondary transition-colors hover:border-white/25 hover:text-textPrimary"
              >
                {asset.sector} sector
              </Link>
            )}
            {asset.industry && asset.industry !== asset.sector && (
              <span className="rounded-full border border-white/[0.08] px-3 py-1 text-textSecondary">
                {asset.industry}
              </span>
            )}
            {ex && (
              <span className="rounded-full border border-white/[0.08] px-3 py-1 text-textSecondary">
                Listed on {ex}
              </span>
            )}
          </p>
        )}
      </section>

      <FactTable
        heading={`${asset.symbol} valuation`}
        caption={`Valuation measures for ${asset.name}, derived from the latest quote and its most recent SEC filing.`}
        rows={valuation}
      />
      <FactTable
        heading={`${asset.symbol} financials`}
        caption={`Trailing-twelve-month figures tagged in ${asset.name}'s XBRL filings with the SEC.`}
        rows={financials}
      />
      <FactTable
        heading={`${asset.symbol} trading statistics`}
        caption={`Range and volume for ${asset.symbol} over the past 52 weeks.`}
        rows={trading}
      />
      {isStock && (
        <FactTable
          heading={`${asset.symbol} dividend`}
          caption={`Dividend history for ${asset.name} over the trailing twelve months.`}
          rows={dividend}
        />
      )}

      {related.length > 0 && (
        <section>
          <h2 className="text-[19px] font-bold tracking-tight">
            Stocks related to {asset.name}
          </h2>
          <p className="mt-2 text-[13px] text-textSecondary">
            {asset.sector
              ? `Other ${asset.sector} companies tracked on FurlPay Markets.`
              : "Other securities tracked on FurlPay Markets."}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.symbol}>
                <Link
                  href={`/markets/${r.symbol}`}
                  className="inline-block rounded-full border border-white/[0.08] px-3.5 py-1.5 text-[13px] text-textSecondary transition-colors hover:border-white/25 hover:text-textPrimary"
                >
                  {r.name} ({r.symbol})
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isStock && <HowToBuy asset={asset} />}

      {faq.length > 0 && (
        <section>
          <h2 className="text-[19px] font-bold tracking-tight">
            {asset.name} ({asset.symbol}) FAQs
          </h2>
          <dl className="mt-4 space-y-5">
            {faq.map((f) => (
              <div key={f.question}>
                <dt className="text-[15px] font-semibold">{f.question}</dt>
                <dd className="mt-1.5 max-w-[72ch] text-[14px] leading-relaxed text-textSecondary">
                  {f.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Sources. A financial page that will not say where a number came from
          is asking to be taken on faith, and every figure above is checkable. */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <h2 className="text-[15px] font-bold tracking-tight">Data sources</h2>
        <ul className="mt-2.5 space-y-1.5 text-[13px] text-textSecondary">
          <li>
            <strong className="text-textPrimary">Price, range and volume</strong> — Yahoo Finance.
            Quotes may be delayed; each carries the exchange timestamp it printed with.
          </li>
          {stats?.provenance?.fundamentals === "sec-edgar" && (
            <li>
              <strong className="text-textPrimary">Financials and valuation</strong> — the company&rsquo;s
              own XBRL filings with the U.S. Securities and Exchange Commission
              {stats.provenance.cik && (
                <>
                  {" "}
                  (
                  <a
                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${stats.provenance.cik}`}
                    rel="noopener nofollow"
                    target="_blank"
                    className="text-accent hover:underline"
                  >
                    CIK {stats.provenance.cik}
                  </a>
                  )
                </>
              )}
              {stats.provenance.fiscalAsOf && `, period ending ${stats.provenance.fiscalAsOf}`}.
            </li>
          )}
          {stats?.provenance?.crypto === "coingecko" && (
            <li>
              <strong className="text-textPrimary">Supply and market data</strong> — CoinGecko.
            </li>
          )}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-textMuted">
          A dash means FurlPay does not have that figure, not that it is zero. Nothing on this page
          is investment advice or a recommendation to buy or sell any security. Figures are provided
          for information only and may be delayed or restated.
        </p>
      </section>
    </div>
  );
}

/** Drop rows with no value. A table of em-dashes is not a fact table. */
function rows(pairs: [string, string][]): [string, string][] {
  return pairs.filter(([, v]) => v !== DASH);
}

function FactTable({
  heading,
  caption,
  rows,
}: {
  heading: string;
  caption: string;
  rows: [string, string][];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-[19px] font-bold tracking-tight">{heading}</h2>
      <p className="mt-2 text-[13px] text-textSecondary">{caption}</p>
      <table className="mt-3 w-full max-w-[640px] text-[14px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-white/[0.05]">
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-textSecondary">
                {label}
              </th>
              <td className="py-2.5 text-right font-semibold tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Transactional-intent section: "how to buy NVDA" is a different query from
 * "NVDA stock price", and this is the part of the page where FurlPay has an
 * answer a data site does not.
 *
 * Server-rendered like everything else here, so it is in the initial HTML.
 *
 * No commission figure and no minimum investment appear, in the copy or in the
 * FAQ. FurlPay publishes neither, and inventing one to fill an obvious gap in a
 * "how to buy" section is how a page ends up making a financial claim its own
 * product does not honour. See the note in lib/markets/seo.ts.
 */
function HowToBuy({ asset }: { asset: MergedAsset }) {
  const steps = howToBuySteps(asset);
  return (
    <section>
      <h2 className="text-[19px] font-bold tracking-tight">
        How to buy {asset.symbol} on FurlPay
      </h2>
      <p className="mt-2 max-w-[72ch] text-[13px] text-textSecondary">
        Invest a chosen dollar amount in {asset.name} with fractional shares.
      </p>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.12] text-[12px] font-semibold tabular-nums text-textSecondary"
            >
              {i + 1}
            </span>
            <span className="max-w-[68ch]">
              <span className="block text-[14.5px] font-semibold">{step.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-relaxed text-textSecondary">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex flex-wrap gap-2.5">
        <Link
          href="/investing"
          className="inline-block rounded-full bg-accent px-4 py-2 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90"
        >
          Start investing
        </Link>
        <Link
          href="/signup"
          className="inline-block rounded-full border border-white/[0.12] px-4 py-2 text-[13.5px] font-semibold text-textSecondary transition-colors hover:border-white/25 hover:text-textPrimary"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-3 max-w-[72ch] text-[11.5px] leading-relaxed text-textMuted">
        Investing involves risk, including possible loss of principal. Nothing here is investment
        advice or a recommendation to buy or sell {asset.symbol}.
      </p>
    </section>
  );
}
