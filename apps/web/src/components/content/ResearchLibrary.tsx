import Link from "next/link";
import ContentCard from "@/components/content/ContentCard";
import { EmptyState } from "@/components/content/ContentShell";
import { CADENCES, RESEARCH_DESKS, filterResearch, publishedReports, reportSummary, type Cadence } from "@/lib/content";

// Server-rendered library: every filter is a plain link or a GET form, so the
// results are real, crawlable HTML and work without JavaScript. Unknown filter
// values are dropped rather than trusted.

export interface LibraryFilters {
  desk?: string;
  cadence?: string;
  year?: string;
  q?: string;
}

export function sanitizeFilters(raw: Record<string, string | string[] | undefined>): LibraryFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const desk = one(raw.desk);
  const cadence = one(raw.cadence);
  const year = one(raw.year);
  const q = one(raw.q)?.slice(0, 80);
  return {
    desk: RESEARCH_DESKS.some((d) => d.slug === desk) ? desk : undefined,
    cadence: cadence && cadence in CADENCES ? cadence : undefined,
    year: year && /^20\d\d$/.test(year) ? year : undefined,
    q,
  };
}

function href(base: string, f: LibraryFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function Chip({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon ${
        active ? "border-neon/50 bg-neon/10 text-neon" : "border-white/10 text-textSecondary hover:border-white/25"
      }`}
    >
      {children}
    </Link>
  );
}

export default function ResearchLibrary({ base, filters, lockedDesk }: { base: string; filters: LibraryFilters; lockedDesk?: string }) {
  const f = { ...filters, desk: lockedDesk ?? filters.desk };
  const all = publishedReports();
  const results = filterResearch(f, all);
  const years = [...new Set(all.map((r) => r.publishedAt.slice(0, 4)))].sort().reverse();
  const cadencesInUse = (Object.keys(CADENCES) as Cadence[]).filter((c) => all.some((r) => r.cadence === c));
  const filtered = !!(f.cadence || f.year || f.q || (!lockedDesk && f.desk));

  return (
    <section aria-labelledby="library" className="mt-12">
      <h2 id="library" className="sr-only">Research library</h2>

      <form action={base} method="get" role="search" className="flex max-w-xl gap-2">
        {f.cadence && <input type="hidden" name="cadence" value={f.cadence} />}
        {f.year && <input type="hidden" name="year" value={f.year} />}
        {!lockedDesk && f.desk && <input type="hidden" name="desk" value={f.desk} />}
        <label htmlFor="research-q" className="sr-only">Search research</label>
        <input
          id="research-q"
          name="q"
          defaultValue={f.q ?? ""}
          placeholder="Search reports, e.g. USDC, GENIUS Act, Singapore"
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[14px] outline-none placeholder:text-textMuted focus:border-neon/50"
        />
        <button type="submit" className="btn-green px-4 py-2 text-[14px]">Search</button>
      </form>

      {(cadencesInUse.length > 1 || years.length > 1) && (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Filters">
          {cadencesInUse.length > 1 &&
            cadencesInUse.map((c) => (
              <Chip key={c} to={href(base, { ...f, desk: lockedDesk ? undefined : f.desk, cadence: f.cadence === c ? undefined : c })} active={f.cadence === c}>
                {CADENCES[c]}
              </Chip>
            ))}
          {years.length > 1 &&
            years.map((y) => (
              <Chip key={y} to={href(base, { ...f, desk: lockedDesk ? undefined : f.desk, year: f.year === y ? undefined : y })} active={f.year === y}>
                {y}
              </Chip>
            ))}
        </div>
      )}

      <div className="mt-8 flex items-baseline justify-between border-b border-white/10 pb-4">
        <p className="text-[13px] text-textMuted" aria-live="polite">
          {results.length} {results.length === 1 ? "report" : "reports"}
          {filtered && (
            <>
              {" · "}
              <Link href={lockedDesk ? base : "/research"} className="text-neon hover:underline">Clear filters</Link>
            </>
          )}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={all.length === 0 ? "No research published yet" : "No reports match these filters"}
            body={
              all.length === 0
                ? "FurlPay Research is in preparation. Reports appear here only after editorial review and source validation."
                : "Try a different search term, or clear the filters."
            }
            action={all.length === 0 ? { label: "Read the blog", href: "/blog" } : { label: "Clear filters", href: lockedDesk ? base : "/research" }}
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r, i) => (
            <li key={r.slug}>
              <ContentCard item={reportSummary(r)} priority={i < 3} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
