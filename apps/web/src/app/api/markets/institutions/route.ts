import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { INSTITUTIONS } from "@/lib/markets/institutions";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/markets/institutions — the 13F filers this app can read.
//
// This route touches no upstream. It returns the registry: which managers are
// available and what their SEC identifiers are. Every actual holding comes from
// /api/markets/institutions/[cik], which parses the filing at request time.
//
// Deliberately no counts, totals or "assets under management" here. Those are
// properties of a filing, and a filing has to be fetched to have them; putting
// a number on this route would mean either caching one that goes stale every
// quarter or fetching 35 information tables to render a menu.
export async function GET(req: NextRequest) {
  // Anonymous readers are served, so the middleware's mutating-method baseline
  // does not cover this. Cheap route, but an unbounded one is still a free
  // amplifier pointed at the rest of the site's budget.
  const limited = await rateLimitOr429(req, "markets.institutions", {
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;

  return NextResponse.json({
    institutions: INSTITUTIONS.map((i) => ({
      slug: i.slug,
      cik: i.cik,
      // Both spellings travel: `name` is what EDGAR calls the filer and is what
      // a reader would search for there; `label` is what reads correctly in a
      // heading. Sending only the tidy one makes the filing unfindable.
      name: i.name,
      label: i.label,
      kind: i.kind,
      /** Where the filings themselves live, so the citation is one hop away. */
      edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${i.cik}&type=13F-HR&dateb=&owner=include&count=40`,
    })),
    asOf: new Date().toISOString(),
  });
}
