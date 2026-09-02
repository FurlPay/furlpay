"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Landmark, LineChart, Users } from "lucide-react";
import { INSTITUTIONS, type InstitutionKind } from "@/lib/markets/institutions";

// /markets/institutions — the filers whose 13F this app can read.
//
// Rendered from the registry alone: no filing is fetched to draw this list, so
// it carries no totals, no position counts and no rankings. Those all require
// parsing an information table, and doing that 35 times to paint a menu would
// spend the site's whole EDGAR budget on navigation.
//
// The absence is the honest version anyway. "Largest holders", "top funds" and
// similar orderings are the genre's standard furniture and every one of them is
// a claim about portfolios that a menu has not read.

const GROUPS: { kind: InstitutionKind; title: string; blurb: string; icon: typeof Landmark }[] = [
  {
    kind: "bank",
    title: "Banks & broker-dealers",
    blurb:
      "Much of what these report is market-making and client facilitation inventory, held to service trades rather than as a house view.",
    icon: Landmark,
  },
  {
    kind: "asset-manager",
    title: "Asset managers",
    blurb:
      "Index and mutual fund managers hold nearly everything, nearly always — which is why the size of a position here says little about conviction.",
    icon: Building2,
  },
  {
    kind: "hedge-fund",
    title: "Hedge funds",
    blurb:
      "Discretionary and systematic managers. A 13F shows only their long US-listed book: no shorts, no hedges, no derivatives at cost.",
    icon: LineChart,
  },
  {
    kind: "other",
    title: "Operating companies & family offices",
    blurb: "Filers reporting for their own account rather than for clients.",
    icon: Users,
  },
];

export default function InstitutionsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    // Both spellings are searched: a reader may type the readable name or the
    // shouty one EDGAR uses, and a CIK is a perfectly reasonable thing to paste.
    //
    // The digit check is explicit rather than a fallback sentinel: an empty
    // string is a substring of every CIK, so a query with no digits in it would
    // otherwise match all 35 filers on the CIK arm alone.
    const digits = q.replace(/\D/g, "");
    return INSTITUTIONS.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (digits !== "" && i.cik.includes(digits))
    );
  }, [query]);

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
          Form 13F
        </p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-tighter">
          Institutional filings
        </h1>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-textSecondary">
          Institutional managers with discretion over $100M or more of US-listed
          securities report their long positions once a quarter, within 45 days
          of quarter end. Every holding shown here is parsed from the filing on
          EDGAR — not from a summary of it.
        </p>

        <label className="mt-5 block">
          <span className="sr-only">Search filers</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a manager, or paste a CIK"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[14px] outline-none placeholder:text-textSecondary/60 focus:border-accent/50"
          />
        </label>
      </div>

      {matches ? (
        <section className="mt-6 px-5">
          <h2 className="text-[13px] font-bold text-textSecondary">
            {matches.length} {matches.length === 1 ? "filer" : "filers"}
          </h2>
          <ul className="mt-2.5 space-y-2">
            {matches.map((i) => (
              <FilerRow key={i.slug} slug={i.slug} label={i.label} name={i.name} cik={i.cik} />
            ))}
          </ul>
          {matches.length === 0 && (
            <p className="mt-3 text-[13px] leading-relaxed text-textSecondary">
              No filer in this list matches that. The list covers {INSTITUTIONS.length}{" "}
              managers, not every 13F filer — there are thousands, and each one
              here was checked against EDGAR by hand.
            </p>
          )}
        </section>
      ) : (
        GROUPS.map((g) => {
          const rows = INSTITUTIONS.filter((i) => i.kind === g.kind);
          if (rows.length === 0) return null;
          const Icon = g.icon;
          return (
            <section key={g.kind} className="mt-7 px-5">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-accent" />
                <h2 className="text-[15px] font-bold">{g.title}</h2>
                <span className="text-[12px] text-textSecondary">{rows.length}</span>
              </div>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-textSecondary">
                {g.blurb}
              </p>
              <ul className="mt-2.5 space-y-2">
                {rows.map((i) => (
                  <FilerRow key={i.slug} slug={i.slug} label={i.label} name={i.name} cik={i.cik} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <p className="mt-8 px-5 text-[11px] leading-relaxed text-textSecondary/70">
        Form 13F covers long positions in US-listed securities only. It excludes
        short positions, cash, bonds and non-US listings, and describes a quarter
        end up to 45 days in the past. The SEC does not verify these filings.
      </p>
    </div>
  );
}

function FilerRow({
  slug,
  label,
  name,
  cik,
}: {
  slug: string;
  label: string;
  name: string;
  cik: string;
}) {
  return (
    <li>
      <Link
        href={`/markets/institutions/${slug}`}
        className="tap flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
      >
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold">{label}</span>
          {/* EDGAR's own spelling, shown because it is what makes the filing
              findable at the source — not because it is prettier. */}
          <span className="mt-0.5 block truncate text-[11px] text-textSecondary">
            {name} · CIK {cik}
          </span>
        </span>
        <span className="ml-3 shrink-0 text-[11px] font-semibold text-accent">13F</span>
      </Link>
    </li>
  );
}
