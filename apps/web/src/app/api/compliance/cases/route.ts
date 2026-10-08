import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { listStates } from "@/lib/settlement/onboardingStore";
import { CASE_STATUSES, CASE_TYPES, SEVERITIES, newCase, slaState } from "@/lib/compliance/cases";
import { CaseStoreUnavailable, insertCaseIfAbsent, listCases } from "@/lib/compliance/caseStore";
import { syncOnboardingCases } from "@/lib/compliance/caseSync";

// GET  /api/compliance/cases — the case queue (compliance officers only).
//      Derives cases from onboarding reviews and screening hits first
//      (idempotent), then lists with validated filters.
// POST /api/compliance/cases — open a case manually.
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const query = z
  .object({
    status: z.enum(["open", "closed", "all", ...CASE_STATUSES]).default("open"),
    type: z.enum(CASE_TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    assignee: z.enum(["me", "unassigned"]).optional(),
    overdue: z.enum(["1"]).optional(),
  })
  .strict();

const OPEN = ["OPEN", "TRIAGED", "ASSIGNED", "INVESTIGATING", "ESCALATED", "DECISION_PENDING"] as const;

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.cases.read", { limit: 120, windowMs: 60_000 }, me);
  if (limited) return limited;
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filter" }, { status: 400, headers });
  const f = parsed.data;
  try {
    let sync: { opened: number; resolved: number } | { error: string };
    try {
      sync = await syncOnboardingCases(await listStates(500));
    } catch (e) {
      sync = { error: e instanceof Error ? e.message : "Onboarding records unavailable" };
    }
    const status = f.status === "open" ? [...OPEN] : f.status === "closed" ? ["RESOLVED", "CLOSED"] : f.status === "all" ? undefined : [f.status];
    let cases = await listCases({ status: status as never, type: f.type, severity: f.severity, assignee: f.assignee === "me" ? me : undefined, limit: 500 });
    if (f.assignee === "unassigned") cases = cases.filter((c) => !c.assignee);
    const now = Date.now();
    if (f.overdue) cases = cases.filter((c) => slaState(c, now) === "overdue");
    return NextResponse.json(
      {
        sync,
        cases: cases.map((c) => ({ ...c, events: undefined, eventCount: c.events.length, sla: slaState(c, now), self: c.subjectId === me })),
      },
      { headers }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof CaseStoreUnavailable ? e.message : "Case queue unavailable" }, { status: 503, headers });
  }
}

const createSchema = z
  .object({
    type: z.enum(CASE_TYPES),
    subjectType: z.enum(["business", "individual", "transaction", "wallet"]),
    subjectId: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    title: z.string().trim().min(5).max(200),
    severity: z.enum(SEVERITIES),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.cases.create", { limit: 30, windowMs: 60_000 }, me);
  if (limited) return limited;
  const body = await validateBody(req, createSchema);
  if (body instanceof NextResponse) return body;
  if (body.subjectId === me) return NextResponse.json({ error: "You cannot open a case about yourself." }, { status: 403, headers });
  try {
    const c = newCase({ sourceKey: `manual:${crypto.randomUUID()}`, type: body.type, subjectType: body.subjectType, subjectId: body.subjectId, title: body.title, severity: body.severity, actor: me, note: body.reason });
    const { case: saved } = await insertCaseIfAbsent(c);
    audit("compliance.case_opened", me, { caseId: saved.id, type: saved.type, severity: saved.severity, manual: true });
    return NextResponse.json({ case: saved }, { status: 201, headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof CaseStoreUnavailable ? e.message : "The case could not be opened." }, { status: 503, headers });
  }
}
