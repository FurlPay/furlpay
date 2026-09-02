"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { resolveInstitution } from "@/lib/markets/institutions";

// /markets/institutions/[cik] — one manager's latest 13F-HR.
//
// The design problem on this page is not layout, it is arithmetic that looks
// like layout. Three numbers here are routinely merged by published summaries
// and each merge overstates a position:
//
//   * share value and option NOTIONAL are different quantities. They are shown
//     in separate columns and never summed.
//   * option rows count CONTRACTS, not shares. The share column is blank for a
//     row that has no share line, rather than showing the contract count.
//   * the filer's own total includes derivatives; the "holdings" figure a
//     reader means does not. Both are shown, labelled.
//
// The header states the quarter and the filing date rather than "as of today",
// because the filing is up to 45 days behind the quarter it describes on the
// day it is published, and older than that every day after.

interface Position {
  issuer: string;
  cusip: string | null;
  cusip6: string;
  shareValue: number;
  shares: number;
  callValue: number;
  callContracts: number;
  putValue: number;
  putContracts: number;
  shareOfPortfolioPct: number | null;
}

interface Filing {
  managerName: string;
  cik: string;
  periodOfReport: string;
  filedAt: string;
  accession: string;
  sourceUrl: string;
  entries: number;
  issuers: number;
  shareValueTotal: number;
  reportedValueTotal: number;
  filerReportedValueTotal: number;
  reconciled: boolean;
  otherIncludedManagers: string[];
  supersededBy: { form: string; periodOfReport: string; filedAt: string } | null;
  form: string;
  isAmendment: boolean;
  amendmentNo: number | null;
  confidentialOmitted: boolean;
  partialAmendments: {
    accession: string;
    filedAt: string;
    periodOfReport: string;
    amendmentType: string;
    amendmentNo: number | null;
    entries: number;
    value: number;
  }[];
}

interface Payload {
  institution: { slug: string; label: string; name: string; cik: string };
  filing: Filing | null;
  reason?: string;
  positions?: Position[];
  page?: { offset: number; limit: number; total: number };
  disclaimer?: string;
}

const PAGE = 50;

export default function InstitutionPage() {
  const { cik } = useParams<{ cik: string }>();
  const router = useRouter();
  const known = resolveInstitution(cik);

  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (offset: number) => {
      return getJSON<Payload>(`/api/markets/institutions/${cik}?offset=${offset}&limit=${PAGE}`)
        .then((r) => {
          setData(r);
          setRows((prev) => (offset === 0 ? (r.positions ?? []) : [...prev, ...(r.positions ?? [])]));
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the filing"));
    },
    [cik]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (!known) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-semibold">Filer not found</p>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-textSecondary">
          This app reads a hand-checked list of 13F filers rather than every CIK
          on EDGAR.
        </p>
        <Link href="/markets/institutions" className="mt-3 inline-block text-[13px] text-accent">
          See the filers it covers
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-semibold">Could not read the filing</p>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-textSecondary">{error}</p>
        <button onClick={() => { setError(null); void load(0); }} className="tap mt-3 text-[13px] text-accent">
          Try again
        </button>
      </div>
    );
  }

  if (!data) return <Spinner />;

  const f = data.filing;

  return (
    <div className="pb-16">
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <button
          aria-label="Back"
          onClick={() => router.back()}
          className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </header>

      <div className="px-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-textSecondary">
          {/* The form actually served. A restatement is still a complete
              report, but it is not the original one and should not claim to be. */}
          {f?.isAmendment ? `Form ${f.form} · restatement` : "Form 13F-HR"}
        </p>
        <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-tighter">
          {known.label}
        </h1>
        <p className="mt-1 text-[11px] text-textSecondary">
          {known.name} · CIK {known.cik}
        </p>
      </div>

      {!f ? (
        <div className="mx-5 mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[13px] leading-relaxed text-textSecondary">
            {data.reason ??
              "No 13F-HR could be read for this filer right now."}
          </p>
        </div>
      ) : (
        <>
          {/* The filing is a snapshot of a past quarter. Say so first, in the
              same visual weight as the numbers, rather than in a footnote. */}
          <div className="mx-5 mt-5 rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <dl className="grid grid-cols-2 gap-y-3 text-[13px]">
              <Cell label="Quarter ended" value={f.periodOfReport || "—"} />
              <Cell label="Filed" value={f.filedAt || "—"} />
              <Cell label="Positions" value={f.entries.toLocaleString("en-US")} />
              <Cell label="Issuers" value={f.issuers.toLocaleString("en-US")} />
            </dl>
          </div>

          {f.supersededBy && (
            <Notice tone="warn">
              This is not this filer&rsquo;s most recent report. They have since
              filed a {f.supersededBy.form} for the quarter ended{" "}
              {f.supersededBy.periodOfReport} — a notice that their holdings are
              reported on another manager&rsquo;s filing. The positions below are
              from {f.periodOfReport}.
            </Notice>
          )}

          {f.confidentialOmitted && (
            <Notice tone="warn">
              This report omits positions the filer asked the SEC to keep
              confidential — usually a stake still being accumulated. The totals
              below are therefore not the whole book, and the missing positions
              appear on a later amendment, sometimes several quarters on.
            </Notice>
          )}

          {f.partialAmendments.length > 0 && (
            <Notice tone="muted">
              Since this report, the filer has submitted{" "}
              {f.partialAmendments.length}{" "}
              {f.partialAmendments.length === 1 ? "amendment" : "amendments"}{" "}
              adding holdings rather than restating them
              {f.partialAmendments[0]
                ? ` (${f.partialAmendments[0].entries} ${
                    f.partialAmendments[0].entries === 1 ? "position" : "positions"
                  }, ${compactUsd(f.partialAmendments[0].value)}, filed ${f.partialAmendments[0].filedAt})`
                : ""}
              . Those positions are not added into the totals here: the sums
              shown are the filer&rsquo;s own, and merging would replace them
              with ours.
            </Notice>
          )}

          {!f.reconciled && (
            <Notice tone="warn">
              Our parse of this filing does not match the totals the filer states
              on it. The figures below disagree with the source and should not be
              relied on until that is resolved.
            </Notice>
          )}

          {f.otherIncludedManagers.length > 0 && (
            <Notice tone="muted">
              This is a combination report covering {f.otherIncludedManagers.length}{" "}
              other included {f.otherIncludedManagers.length === 1 ? "manager" : "managers"}.
              The totals are a sum across that structure, not one desk&rsquo;s book.
            </Notice>
          )}

          {/* Two totals, labelled. Quoting the reported total as "holdings" is
              the single most common way these filings get misreported. */}
          <div className="mx-5 mt-4 grid grid-cols-2 gap-3">
            <Stat
              label="Share positions"
              value={compactUsd(f.shareValueTotal)}
              note="Common and other share lines only."
            />
            <Stat
              label="Total reported"
              value={compactUsd(f.reportedValueTotal)}
              note="Includes options at the notional value of the underlying."
            />
          </div>

          <section className="mt-7 px-5">
            <h2 className="text-[15px] font-bold">Largest positions</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-textSecondary">
              Ordered by share value. Option rows are reported at notional and
              counted in contracts, so they are kept in their own columns and
              never added to the share line.
            </p>

            <ul className="mt-3 space-y-2">
              {rows.map((p, i) => (
                <li
                  key={`${p.cusip6}-${i}`}
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{p.issuer}</p>
                      <p className="mt-0.5 text-[11px] text-textSecondary">
                        {/* The share CUSIP when there is a share line; the
                            issuer prefix when the position is options only. */}
                        {p.cusip ? `CUSIP ${p.cusip}` : `Issuer ${p.cusip6} · options only`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[14px] font-semibold tabular-nums">
                        {p.shareValue > 0 ? compactUsd(p.shareValue) : "—"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-textSecondary tabular-nums">
                        {p.shareOfPortfolioPct !== null && p.shareValue > 0
                          ? `${p.shareOfPortfolioPct.toFixed(2)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-textSecondary tabular-nums">
                    {/* Shares only where a share line exists. A zero here would
                        read as "holds none", which is different from "this row
                        is a derivative". */}
                    {p.shares > 0 && <span>{p.shares.toLocaleString("en-US")} shares</span>}
                    {p.callContracts > 0 && (
                      <span>
                        calls {compactUsd(p.callValue)} notional ·{" "}
                        {p.callContracts.toLocaleString("en-US")} contracts
                      </span>
                    )}
                    {p.putContracts > 0 && (
                      <span>
                        puts {compactUsd(p.putValue)} notional ·{" "}
                        {p.putContracts.toLocaleString("en-US")} contracts
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {data.page && rows.length < data.page.total && (
              <button
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void load(rows.length).finally(() => setLoadingMore(false));
                }}
                className="tap mt-4 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-[13px] font-semibold disabled:opacity-50"
              >
                {loadingMore
                  ? "Loading…"
                  : `Show more — ${(data.page.total - rows.length).toLocaleString("en-US")} issuers left`}
              </button>
            )}
          </section>

          <div className="mt-7 px-5">
            <a
              href={f.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tap inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent"
            >
              Read the filing on EDGAR
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="mt-1 text-[11px] text-textSecondary">
              Accession {f.accession}
            </p>
          </div>
        </>
      )}

      <p className="mt-8 px-5 text-[11px] leading-relaxed text-textSecondary/70">
        {data.disclaimer ??
          "Form 13F reports long positions in US-listed securities held at quarter end, filed up to 45 days later. It excludes short positions, cash, bonds and non-US listings. The SEC does not verify these filings."}{" "}
        Nothing here is investment advice.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-textSecondary">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <p className="text-[11px] text-textSecondary">{label}</p>
      <p className="mt-1 text-[18px] font-extrabold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-textSecondary/80">{note}</p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "muted"; children: React.ReactNode }) {
  return (
    <div
      className={`mx-5 mt-4 flex gap-2.5 rounded-xl border p-3.5 ${
        tone === "warn"
          ? "border-amber-400/30 bg-amber-400/[0.07]"
          : "border-white/8 bg-white/[0.03]"
      }`}
    >
      {tone === "warn" && (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
      )}
      <p className="text-[12px] leading-relaxed text-textSecondary">{children}</p>
    </div>
  );
}

/** Whole dollars, abbreviated, with the unit spelled out.
 *
 * A 13F is denominated in whole dollars and the totals run to the trillions,
 * where an unabbreviated figure is unreadable and a truncated one is a
 * different number. Values below a million keep their digits. */
function compactUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
