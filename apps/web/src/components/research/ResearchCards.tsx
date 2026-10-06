import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  CalendarDays,
  ChartColumnIncreasing,
  ChevronRight,
  CreditCard,
  Database,
  FileText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import ReportDownload from "@/components/content/ReportDownload";
import { CADENCES, type Cadence, type Report } from "@/lib/content";

// The Research hub's card family. One surface (border, radius, padding,
// hover) shared by every variant, so desks, the featured report, series and
// the programme read as one system.

const SURFACE =
  "rounded-card border border-white/10 bg-white/[0.02] transition-[border-color,background-color,transform] duration-200";
const HOVER = "hover:border-neon/35 hover:bg-white/[0.035]";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon";

// ── Research desk ───────────────────────────────────────────────────────────

export const DESK_ICONS: Record<string, LucideIcon> = {
  "stablecoin-markets": Database,
  security: ShieldCheck,
  "payments-infrastructure": CreditCard,
  regulation: FileText,
  networks: Box,
  "market-intelligence": ChartColumnIncreasing,
};

export function DeskCard({ slug, title, blurb }: { slug: string; title: string; blurb: string }) {
  const Icon = DESK_ICONS[slug] ?? FileText;
  return (
    <Link href={`/research/${slug}`} className={`group flex h-full items-start gap-4 p-5 ${SURFACE} ${HOVER} ${FOCUS}`}>
      <Icon aria-hidden strokeWidth={1.5} className="mt-0.5 h-7 w-7 shrink-0 text-neon" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug">{title}</span>
        <span className="mt-1.5 block text-[13px] leading-relaxed text-textSecondary">{blurb}</span>
      </span>
      <ArrowRight
        aria-hidden
        className="mt-6 h-4 w-4 shrink-0 text-neon transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

// ── Featured report ─────────────────────────────────────────────────────────

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function FeaturedReportCard({ report, topics }: { report: Report; topics: string[] }) {
  const href = `/reports/${report.slug}`;
  const facts = [
    report.pageCount ? { icon: FileText, text: `${report.pageCount} pages` } : null,
    { icon: CalendarDays, text: LONG_DATE.format(new Date(`${report.publishedAt}T00:00:00Z`)) },
    report.cadence ? { icon: ChartColumnIncreasing, text: CADENCES[report.cadence] } : null,
  ].filter((f): f is { icon: LucideIcon; text: string } => f !== null);

  return (
    <article
      aria-labelledby={`featured-${report.slug}`}
      className="relative isolate grid overflow-hidden rounded-card border border-neon/30 bg-[radial-gradient(ellipse_55%_85%_at_20%_55%,rgba(0,229,153,0.3),transparent_70%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent)] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
    >
      <div className="relative flex items-center justify-center px-6 pb-2 pt-8 md:py-8">
        {report.coverImage ? (
          <Link href={href} tabIndex={-1} aria-hidden className="group block">
            <Image
              src={report.coverImage}
              alt=""
              width={report.coverWidth ?? 1024}
              height={report.coverHeight ?? 1536}
              sizes="(min-width: 768px) 320px, 220px"
              className="h-auto w-[220px] drop-shadow-[0_24px_40px_rgba(0,0,0,0.6)] transition-transform duration-200 group-hover:-translate-y-1 md:w-[min(100%,320px)]"
            />
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col justify-center px-6 pb-8 pt-4 md:py-10 md:pl-2 md:pr-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neon">
          Featured · {report.cadence ? CADENCES[report.cadence] : "Report"}
        </p>
        <h3 id={`featured-${report.slug}`} className="mt-3 text-[clamp(28px,3.2vw,40px)] font-bold leading-[1.08] tracking-tight">
          <Link href={href} className={`hover:text-white/90 ${FOCUS}`}>
            {report.title}
          </Link>
        </h3>
        {topics.length > 0 && (
          <p className="mt-4 text-[15px] text-textSecondary">{topics.join(" · ")}</p>
        )}
        <ul className="mt-6 flex flex-wrap gap-x-7 gap-y-3 text-[14px]">
          {facts.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <Icon aria-hidden strokeWidth={1.5} className="h-5 w-5 text-white/70" />
              {text}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {report.pdfPath ? (
            <ReportDownload
              slug={report.slug}
              reportTitle={report.title}
              fileHref={report.pdfPath.replace(/\.pdf$/, "-lite.pdf")}
              fileName={`FurlPay-${report.slug}.pdf`}
              coverSrc={report.coverImage ?? ""}
              className="btn-green inline-flex h-12 items-center justify-center gap-2.5 whitespace-nowrap rounded-[10px] px-7 text-[15px]"
            >
              Download PDF
              <ArrowDownToLine aria-hidden className="h-4 w-4" />
            </ReportDownload>
          ) : null}
          <Link
            href={href}
            className={`inline-flex h-12 items-center justify-center gap-2.5 whitespace-nowrap rounded-[10px] border border-white/20 px-7 text-[15px] font-semibold transition-colors hover:border-white/40 ${FOCUS}`}
          >
            Read report
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}

// ── Series (a planned publication with no edition yet) ──────────────────────

export type SeriesArtKind = "rings" | "shield" | "cards" | "stack";

export function SeriesCard({
  cadence,
  title,
  blurb,
  deskSlug,
  art,
}: {
  cadence: Cadence;
  title: string;
  blurb: string;
  deskSlug: string;
  art: SeriesArtKind;
}) {
  return (
    <Link
      href={`/research/${deskSlug}`}
      className={`group relative flex h-full flex-col overflow-hidden p-5 ${SURFACE} ${HOVER} ${FOCUS}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neon">{CADENCES[cadence]}</span>
      <SeriesArt kind={art} />
      <FileText aria-hidden strokeWidth={1.5} className="mt-auto h-5 w-5 text-neon" />
      <span className="mt-3 block text-[17px] font-semibold leading-snug">{title}</span>
      <span className="mt-2 block text-[13px] leading-relaxed text-textSecondary">{blurb}</span>
      <span className="mt-5 flex items-center justify-between text-[13px]">
        {/* No edition exists yet, so no date: "In preparation" is the truth. */}
        <span className="text-textMuted">In preparation</span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-neon">
          Desk
          <ArrowRight aria-hidden className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}

/** Monochrome FurlPay-green line art: decoration only. */
function SeriesArt({ kind }: { kind: SeriesArtKind }) {
  const stroke = "rgb(0 229 153 / 0.55)";
  const fill = "rgb(0 229 153 / 0.08)";
  return (
    <svg aria-hidden viewBox="0 0 120 90" className="pointer-events-none absolute right-2 top-2 h-28 w-40 opacity-90 transition-transform duration-200 group-hover:scale-[1.03]">
      <defs>
        <radialGradient id={`glow-${kind}`} cx="60%" cy="45%" r="60%">
          <stop offset="0" stopColor="rgb(0 229 153 / 0.22)" />
          <stop offset="1" stopColor="rgb(0 229 153 / 0)" />
        </radialGradient>
      </defs>
      <rect width="120" height="90" fill={`url(#glow-${kind})`} />
      {kind === "rings" && (
        <g fill="none" stroke={stroke}>
          <circle cx="78" cy="42" r="30" fill={fill} />
          <circle cx="86" cy="42" r="30" />
          <path d="M48 42a30 30 0 0 1 30-30" strokeWidth="3" />
        </g>
      )}
      {kind === "shield" && (
        <g fill={fill} stroke={stroke}>
          <path d="M80 10l26 10v20c0 18-12 30-26 38-14-8-26-20-26-38V20z" />
          <path d="M80 22l16 6v12c0 11-7 18-16 23-9-5-16-12-16-23V28z" fill="none" />
        </g>
      )}
      {kind === "cards" && (
        <g fill={fill} stroke={stroke}>
          <rect x="52" y="20" width="50" height="34" rx="5" transform="rotate(-12 77 37)" />
          <rect x="62" y="32" width="50" height="34" rx="5" transform="rotate(-12 87 49)" />
          <path d="M70 58l10-8 8 4 14-12" fill="none" />
        </g>
      )}
      {kind === "stack" && (
        <g fill={fill} stroke={stroke}>
          <ellipse cx="82" cy="62" rx="24" ry="8" />
          <ellipse cx="82" cy="48" rx="24" ry="8" />
          <ellipse cx="82" cy="34" rx="24" ry="8" />
          <ellipse cx="82" cy="20" rx="24" ry="8" />
        </g>
      )}
    </svg>
  );
}

// ── Publishing programme ────────────────────────────────────────────────────

export function ProgrammeCard({ cadence, title, href }: { cadence: Cadence; title: string; href: string }) {
  return (
    <Link href={href} className={`group flex h-full items-center justify-between gap-3 px-5 py-4 ${SURFACE} ${HOVER} ${FOCUS}`}>
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-neon">{cadence}</span>
        <span className="mt-2 block text-[14px] font-semibold leading-snug">{title}</span>
      </span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-neon transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}
