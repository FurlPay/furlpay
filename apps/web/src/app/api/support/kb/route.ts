import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { SUPPORT_KB, retrieveKb } from "@/lib/support/kb";

// GET /api/support/kb — the published help-centre index, and keyword search
// over it. Public: this is the same content anyone can read at /docs/help/*,
// so there is nothing here a visitor could not already see.
//
// WHY A ROUTE RATHER THAN A CLIENT IMPORT. `SUPPORT_KB` is a plain const and
// importing it from the chat widget would work — but the widget ships on every
// marketing page, and the entry `content` fields exist to ground the model, not
// to be rendered. Serving the index keeps that text server-side and out of the
// bundle, and leaves the KB with one definition rather than a client copy that
// can drift from it.
//
// The response is the ARTICLE INDEX ONLY: id, title, href, category. Never
// `content` or `keywords` — the former is retrieval grounding and the latter is
// tuning data; publishing either invites both to be treated as the article.

export const dynamic = "force-dynamic";

/** What the widget renders. Deliberately narrower than `KbEntry`. */
export interface KbIndexEntry {
  id: string;
  title: string;
  href: string;
  category: string;
}

export interface KbIndexResponse {
  articles: KbIndexEntry[];
  /** Echoed back so a stale response cannot be shown against a newer query. */
  query: string;
}

const slim = (e: { id: string; title: string; href: string; category: string }): KbIndexEntry => ({
  id: e.id,
  title: e.title,
  href: e.href,
  category: e.category,
});

export async function GET(req: NextRequest) {
  // Generous: this is a static index and a keystroke-driven search, but it is
  // still a public endpoint and should not be a free amplification vector.
  const limited = await rateLimitOr429(req, "support.kb", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("q") ?? "";
  // Bounded before it reaches the matcher: `retrieveKb` scores against every
  // entry, and an unbounded query is unbounded work per request.
  const query = raw.trim().slice(0, 200);

  // No query means the whole shelf, in authored order — that ordering is
  // editorial (getting started, then the common tasks) and worth preserving.
  const articles = query ? retrieveKb(query, 8).map(slim) : SUPPORT_KB.map(slim);

  return NextResponse.json(
    { articles, query } satisfies KbIndexResponse,
    {
      headers: {
        // The index changes only on deploy. A short public cache keeps the
        // widget instant on repeat opens without holding a stale shelf for long.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      },
    }
  );
}
