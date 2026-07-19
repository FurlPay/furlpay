import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { projectHoldings, projectDividends } from "@/lib/corporateActions/projector";
import { positionQuantity } from "@/lib/corporateActions/lots";
import { loadCorporateActions } from "@/lib/store";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

// GET /api/investing/portfolio — holdings, dividends & performance, scoped to
// the acting user.
//
// Holdings are PROJECTED from the trade-lot ledger (lots + corporate actions +
// live quotes), not read from the mutable `holdings` aggregate. That aggregate
// could not express a split — it had one shares number and one basis number
// with no record of what was actually paid per share — so cost basis, realized
// gain and holding period were all unknowable from it.
//
// Long-term capital gains threshold: a lot held MORE than one year is
// long-term in the US. Surfaced per holding so the client can show the tax
// character of a position before the user sells it.
const LONG_TERM_DAYS = 365;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const quotes = await getQuotes().catch(() => null);

  /** Live quote for a symbol, or undefined when unpriced. */
  const quoteFor = (symbol: string) => {
    const asset = bySymbol.get(symbol);
    const q = quotes && asset ? resolveQuote(quotes, asset) : undefined;
    return q ? { price: q.price, changePct: q.changePct, name: asset?.name } : undefined;
  };

  const lots: TradeLot[] = account.tradeLots ?? [];

  // MIGRATION GUARD. An account hydrated from Postgres before migration 0006 —
  // or on a deployment where it has not been applied — arrives with an empty
  // ledger. Projecting from nothing would report a ZERO portfolio to someone
  // who owns shares, which is far worse than the aggregate's imprecision.
  // Fall back until the ledger is populated for that user.
  const ledgerReady = lots.some((l) => l.status === "open");

  // Ingested corporate actions for the symbols this user holds. Splits/renames
  // adjust the projected holdings below; cash dividends produce entitlements.
  // loadCorporateActions falls back to [] when 0006 isn't applied (or nothing
  // has been ingested), so an un-migrated deployment degrades to "no actions"
  // rather than failing the read.
  const heldSymbols = [...new Set(lots.map((l) => l.symbol))];
  const actions: CorporateAction[] =
    ledgerReady && heldSymbols.length ? await loadCorporateActions(heldSymbols) : [];

  const projected = ledgerReady
    ? projectHoldings(lots, actions, quoteFor)
    : account.holdings.map((h) => {
        const q = quoteFor(h.symbol);
        const price = q?.price ?? h.price;
        return { ...h, price, changePct: q?.changePct ?? h.changePct, marketValue: h.shares * price };
      });

  const marketValue = projected.reduce((s, h) => s + h.marketValue, 0);
  const dayChange = projected.reduce((s, h) => s + (h.marketValue * h.changePct) / 100, 0);
  const costBasis = projected.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  // Unrealized: what the position would earn if closed at today's mark.
  const unrealizedReturn = marketValue - costBasis;

  const now = Date.now();
  const holdings = projected.map((h) => {
    const asset = bySymbol.get(h.symbol);
    const symbolLots = lots.filter((l) => l.symbol === h.symbol && l.status === "open");

    // Oldest open lot decides whether ANY of the position qualifies as
    // long-term; per-lot detail lives behind /api/investing/lots.
    const oldest = symbolLots.reduce<string | null>(
      (acc, l) => (!acc || Date.parse(l.acquiredAt) < Date.parse(acc) ? l.acquiredAt : acc),
      null
    );
    const heldDays = oldest ? Math.floor((now - Date.parse(oldest)) / 86_400_000) : null;

    return {
      ...h,
      logo: asset ? assetLogoPath(asset) : null,
      // Lot-derived detail. Null when the ledger has not been populated for
      // this user yet — the client must not read null as "zero lots held".
      lotCount: ledgerReady ? symbolLots.length : null,
      acquiredAt: oldest,
      heldDays,
      longTerm: heldDays === null ? null : heldDays > LONG_TERM_DAYS,
      unrealizedReturn: round2(h.marketValue - (h.costBasis ?? 0)),
    };
  });

  // Cash-dividend entitlements projected from the ledger on each action's
  // record date (see projectDividends — a split before the record date is
  // applied first so the count is right). Empty until the feed is ingested;
  // honest either way, never fabricated. `status` is inferred at read time from
  // the payment date — the durable dividend_events ledger owns it once the
  // entitlement job writes there.
  const dividends = projectDividends(lots, actions).map((d) => ({
    ...d,
    status: d.paymentDate && Date.parse(d.paymentDate) <= now ? "paid" : "pending",
  }));

  return NextResponse.json({
    holdings,
    dividends,
    performance: {
      marketValue: round2(marketValue),
      dayChange: round2(dayChange),
      dayChangePct: marketValue ? (dayChange / marketValue) * 100 : 0,
      // Retained for API compatibility; equals unrealizedReturn.
      totalReturn: round2(unrealizedReturn),
      totalReturnPct: costBasis ? (unrealizedReturn / costBasis) * 100 : 0,
      costBasis: round2(costBasis),
      unrealizedReturn: round2(unrealizedReturn),
    },
    // Lets clients (and this audit trail) tell a projected portfolio from a
    // legacy aggregate one, instead of guessing.
    source: ledgerReady ? "lot_ledger" : "legacy_aggregate",
    lotCount: lots.filter((l) => l.status === "open").length,
    shareCount: round8(
      [...new Set(lots.map((l) => l.symbol))].reduce((s, sym) => s + positionQuantity(lots, sym), 0)
    ),
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round8(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e8) / 1e8;
}
