import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listRevenueEvents, revenueDurable } from "@/lib/revenue/store";
import {
  arpuMinor,
  byDay,
  byEngine,
  bySource,
  growthPct,
  netRealized,
  takeRateBps,
  totals,
} from "@/lib/revenue/aggregate";

export const dynamic = "force-dynamic";

// GET /api/ops/revenue?days=30 — revenue analytics for the ops console.
//
// ── AUTHORIZATION ──────────────────────────────────────────────────────────
//
// ADMIN_ONLY via requireOpsAdmin, the same guard every other /api/ops route
// uses. This is company accounting data: aggregate revenue, take rates and
// paying-account counts. It is not a user-facing surface and must never become
// one.
//
// ── WHAT IT DOES NOT RETURN ────────────────────────────────────────────────
//
// Aggregates only. No individual event rows, no per-user breakdown, no
// external references (Stripe session ids, transaction hashes), no metadata.
// Those exist in the table for reconciliation, and a reconciliation tool can
// read them with direct database access — but an HTTP endpoint that returns
// them turns one compromised admin session into a dump of every customer's
// payment references, and the dashboard does not need them to draw a chart.
//
// `payingUsers` is a COUNT. No identifiers leave this route.

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  // Each call scans a date range; an admin session holding the refresh button
  // should not be able to turn the console into a load generator.
  const limited = await rateLimitOr429(req, "ops.revenue", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  if (!Number.isFinite(raw) || raw < 1 || raw > MAX_DAYS) {
    return opsError("invalid_range", `days must be between 1 and ${MAX_DAYS}`, 400);
  }
  const days = Math.floor(raw);

  const now = Date.now();
  const windowMs = days * 86_400_000;
  const from = now - windowMs;
  // The immediately preceding window of equal length, for growth.
  const priorFrom = from - windowMs;

  const [current, prior] = await Promise.all([
    listRevenueEvents({ from, to: now }),
    listRevenueEvents({ from: priorFrom, to: from }),
  ]);

  const t = totals(current);
  const priorTotals = totals(prior);

  return opsOk({
    window: { days, from: new Date(from).toISOString(), to: new Date(now).toISOString() },
    // Whether these numbers survive a restart. A dashboard showing revenue
    // from a process-local map must say so rather than implying a ledger.
    durable: revenueDurable(),
    totals: t,
    // Realized net of reversals — the number that should match the bank.
    netRealized: netRealized(t),
    takeRateBps: takeRateBps(current),
    arpuMinor: arpuMinor(current),
    growthPct: growthPct(netRealized(t), netRealized(priorTotals)),
    byEngine: byEngine(current),
    bySource: bySource(current),
    byDay: byDay(current),
  });
}
