import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PayrollConflict } from "@/lib/payroll/repository";
import { createSchedule, listSchedules, scheduleActionSchema, scheduleSchema, updateSchedule } from "@/lib/payroll/schedule";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (e: unknown) => {
  if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
  return NextResponse.json({ error: "Payroll schedules are unavailable. Configure storage and apply migration 0051." }, { status: 503, headers });
};

// Recurring payroll schedules (lib/payroll/schedule.ts). A schedule prepares a
// DRAFT batch from the saved roster every week, fortnight or month; the
// employer still reviews, submits and signs it. Nothing is paid automatically.
//   GET                                  — this employer's schedules
//   POST  { requestId, name, chain, cadence, startOn, dayOfMonth?, lines }
//   PATCH { id, action: "pause" | "resume" } | { id, action: "update", name?, lines? }
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.schedules.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  try { return NextResponse.json({ schedules: await listSchedules(auth.account.user.id) }, { headers }); }
  catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.schedules.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, scheduleSchema); if (input instanceof NextResponse) return input;
  try { return NextResponse.json({ schedule: await createSchedule(auth.account.user.id, input) }, { status: 201, headers }); }
  catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.schedules.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, scheduleActionSchema); if (input instanceof NextResponse) return input;
  try {
    const schedule = await updateSchedule(auth.account.user.id, input);
    return NextResponse.json(schedule ? { schedule } : { error: "Schedule not found" }, { status: schedule ? 200 : 404, headers });
  } catch (e) { return fail(e); }
}
