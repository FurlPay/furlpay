import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireRole } from "@/lib/authz";
import { CATALOG } from "@/lib/markets/catalog";
import { fetchAlpacaCorporateActions, ALPACA_CA_HISTORY_START } from "@/lib/corporateActions/alpaca";
import { saveCorporateActions } from "@/lib/store";

// POST /api/investing/corporate-actions/ingest — pull Alpaca corporate actions
// (splits, cash dividends, renames) into the corporate_actions table. This is
// what turns the projected `dividends` / split-adjusted holdings from "wired but
// empty" into live data.
//
// Admin-gated (requireRole) and rate-limited: it hits a paid upstream and
// writes shared reference data. Idempotent — Alpaca's action id is the PK — so a
// re-run merges in place. A cron trigger can call this later; there is no
// scheduler in the repo yet, so v1 is manual/admin.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const Body = z
  .object({
    // Default: every non-crypto catalog symbol. Explicit list narrows a backfill.
    symbols: z.array(z.string().min(1).max(12)).max(500).optional(),
    start: z.string().regex(DATE).optional(),
    end: z.string().regex(DATE).optional(),
  })
  .strip();

const EQUITY_SYMBOLS = CATALOG.filter((a) => a.kind !== "crypto").map((a) => a.symbol);

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "investing.ca.ingest", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const symbols = body.symbols?.length ? body.symbols.map((s) => s.toUpperCase()) : EQUITY_SYMBOLS;
  const end = body.end ?? new Date().toISOString().slice(0, 10);
  const start = body.start ?? ALPACA_CA_HISTORY_START;
  if (Date.parse(start) > Date.parse(end)) {
    return NextResponse.json({ error: "invalid_range", detail: "start is after end" }, { status: 400 });
  }

  let entries;
  try {
    entries = await fetchAlpacaCorporateActions({ symbols, start, end });
  } catch (e) {
    return NextResponse.json(
      { error: "alpaca_fetch_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
  if (entries === null) {
    return NextResponse.json(
      {
        error: "alpaca_not_configured",
        detail: "Set ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY to ingest corporate actions.",
      },
      { status: 503 },
    );
  }

  const ingested = await saveCorporateActions(entries);
  return NextResponse.json({ ingested, symbolCount: symbols.length, start, end });
}
