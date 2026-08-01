import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { parse } from "@/lib/schemas";

export const dynamic = "force-dynamic";

// Recurring investment (DCA) schedules — "buy $50 of AAPL every week". The
// co-pilot creates these; a cron/worker executes each due schedule by POSTing
// to /api/investing/order.
//
// SECURITY HISTORY: this route was unauthenticated AND kept every user's
// schedules in one process-global array, so any anonymous caller could read
// every user's investment intentions and create standing instructions a worker
// would later act on. Both are fixed below — the route requires a session, and
// schedules are keyed by user id. The store is still in-memory (demo), but it
// is no longer cross-tenant.
interface DcaSchedule {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  notional: number;
  cadence: "day" | "week" | "month";
  createdAt: string;
  nextRun: string;
  active: boolean;
}

// Keyed by user id. A flat array shared by every caller is HOW the cross-tenant
// leak happened; the shape itself has to make that unrepresentable.
const g = globalThis as unknown as { __dca?: Map<string, DcaSchedule[]> };
const byUser = g.__dca ?? (g.__dca = new Map<string, DcaSchedule[]>());

function schedulesFor(userId: string): DcaSchedule[] {
  const existing = byUser.get(userId);
  if (existing) return existing;
  const fresh: DcaSchedule[] = [];
  byUser.set(userId, fresh);
  return fresh;
}

const CADENCE_MS: Record<DcaSchedule["cadence"], number> = {
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
};

/** A recurring order commits future money, so the amount is bounded at both
 *  ends — `.positive()` plus a ceiling, per AGENTS.md rule 1. */
const ScheduleSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,5}$/, "symbol must be 1-5 letters"),
  // Optional rather than `.default()`: the shared `parse()` helper is typed
  // z.ZodType<T>, which collapses Zod's input and output types and would leave
  // the default unreflected in T. Defaulted below instead.
  side: z.enum(["buy", "sell"]).optional(),
  notional: z.coerce.number().positive().max(1_000_000),
  cadence: z.enum(["day", "week", "month"]),
});

/** Caps the standing instructions one account can accumulate. Each is a future
 *  obligation a worker will act on, so an unbounded list is unbounded exposure. */
const MAX_ACTIVE_SCHEDULES = 25;

// GET /api/investing/schedule — the ACTING USER's active schedules.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  return NextResponse.json({
    schedules: schedulesFor(auth.account.user.id).filter((s) => s.active),
  });
}

// POST /api/investing/schedule — create a DCA schedule for the acting user.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Creating a standing instruction is money-adjacent, so it gets a per-user
  // budget tighter than the middleware baseline.
  const limited = await rateLimitOr429(
    req,
    "investing-schedule",
    { limit: 20, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const parsed = parse(ScheduleSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { symbol, notional, cadence } = parsed.data;
  const side = parsed.data.side ?? "buy";

  const schedules = schedulesFor(userId);
  if (schedules.filter((s) => s.active).length >= MAX_ACTIVE_SCHEDULES) {
    return NextResponse.json(
      {
        error: "schedule_limit_reached",
        detail: `You can have at most ${MAX_ACTIVE_SCHEDULES} active schedules. Cancel one first.`,
      },
      { status: 409 }
    );
  }

  const now = Date.now();
  const schedule: DcaSchedule = {
    id: randomUUID(),
    symbol,
    side,
    notional: Math.round(notional * 100) / 100,
    cadence,
    createdAt: new Date(now).toISOString(),
    nextRun: new Date(now + CADENCE_MS[cadence]).toISOString(),
    active: true,
  };
  schedules.push(schedule);

  return NextResponse.json({ ok: true, schedule }, { status: 201 });
}
