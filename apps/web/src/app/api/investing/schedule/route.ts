import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// Recurring investment (DCA) schedules — "buy $50 of AAPL every week". The
// co-pilot creates these; a cron/worker executes each due schedule by POSTing
// to /api/investing/order. Stored in-memory for the demo (a live build persists
// to the ledger and drives execution from a scheduler).
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
const g = globalThis as unknown as { __dca?: DcaSchedule[] };
const schedules = g.__dca ?? (g.__dca = []);

const CADENCE_MS: Record<string, number> = {
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
};

// GET /api/investing/schedule — list active DCA schedules.
export function GET() {
  return NextResponse.json({ schedules: schedules.filter((s) => s.active) });
}

// POST /api/investing/schedule — create a DCA schedule.
// Body: { symbol, side?, notional, cadence }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const symbol = String(body?.symbol ?? "").toUpperCase();
  const side = body?.side === "sell" ? "sell" : "buy";
  const notional = Number(body?.notional);
  const cadence = String(body?.cadence ?? "");

  if (!symbol || !/^[A-Z]{1,5}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid_symbol" }, { status: 400 });
  }
  if (!Number.isFinite(notional) || notional <= 0) {
    return NextResponse.json({ error: "invalid_notional" }, { status: 400 });
  }
  if (!CADENCE_MS[cadence]) {
    return NextResponse.json({ error: "cadence must be day, week or month" }, { status: 400 });
  }

  const now = Date.now();
  const schedule: DcaSchedule = {
    id: randomUUID(),
    symbol,
    side,
    notional: Math.round(notional * 100) / 100,
    cadence: cadence as DcaSchedule["cadence"],
    createdAt: new Date(now).toISOString(),
    nextRun: new Date(now + CADENCE_MS[cadence]).toISOString(),
    active: true,
  };
  schedules.push(schedule);

  return NextResponse.json({ ok: true, schedule }, { status: 201 });
}
