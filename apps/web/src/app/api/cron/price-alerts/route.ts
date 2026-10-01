import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { getQuotes } from "@/lib/markets/quotes";
import { sweepAlerts } from "@/lib/alerts/dispatch";

export const dynamic = "force-dynamic";

// GET /api/cron/price-alerts — evaluate every tracked quote against user alerts.
//
// WHY A SWEEP AND NOT A STREAM. The alert engine is built around a price tick,
// and the textbook wiring is a WebSocket feed pushing ticks as they happen. This
// codebase has no such feed: quotes arrive through lib/markets/quotes.ts, which
// is a cached pull with a TTL. Pretending otherwise would mean writing a
// subscriber for a stream that does not exist.
//
// So the sweep runs on the scheduler and evaluates the whole quote map at once.
// The engine does not care — evaluateTick takes a symbol and a price, and where
// they came from is not its concern. When a streaming feed is wired, it calls the
// same function per tick and this route can stay as the safety net that catches
// anything the stream missed.
//
// WHAT THIS MEANS FOR USERS, and it should be said rather than implied: alert
// latency is bounded by the cron interval and the quote cache TTL, not by the
// market. A price that crosses a target and comes back within one interval may
// never be seen. That is honest for a payments app with a pull-based quote
// source; it would not be acceptable for a trading terminal, and closing that gap
// is a streaming-feed problem, not an engine problem.

export async function GET(req: NextRequest) {
  // Fails closed with no secret configured — an unauthenticated caller must not
  // be able to drive the push fan-out.
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const quotes = await getQuotes();
  const ticks = [...quotes.entries()]
    // Only live prices arm a notification. A stale or seeded number crossing a
    // target is not a market event, and waking someone for one is worse than
    // silence.
    .filter(([, q]) => q.live && Number.isFinite(q.price) && q.price > 0)
    .map(([symbol, q]) => ({ symbol, price: q.price }));

  const result = await sweepAlerts(ticks);

  return NextResponse.json(
    { ok: true, ...result, quotesConsidered: quotes.size },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Vercel Cron calls GET; EventBridge Scheduler (infra/aws/modules/env/scheduler.tf)
// calls POST — it used to get a 405 (audit P1-3). Same handler, same auth.
export const POST = GET;
