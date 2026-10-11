import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { getAccountDurable } from "@/lib/store";
import { evaluate, inWindow, RULES } from "@/lib/compliance/monitoring";
import { newCase } from "@/lib/compliance/cases";
import { CaseStoreUnavailable, insertCaseIfAbsent } from "@/lib/compliance/caseStore";

// GET  /api/compliance/monitoring — the rule catalogue (versions, thresholds, disabled reasons).
// POST /api/compliance/monitoring — evaluate one account's ledger history.
//      dryRun: true = back-test only (alerts returned, no cases opened).
//      Otherwise every alert opens a case once (idempotent on the alert key).
// Reads the existing ledger rows; never changes a balance or holds a payment.
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  return NextResponse.json({ rules: RULES }, { headers });
}

const iso = z.string().datetime({ offset: true });
const evalSchema = z
  .object({
    subjectId: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9_.:@-]+$/),
    from: iso.optional(),
    to: iso.optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.monitoring.evaluate", { limit: 30, windowMs: 60_000 }, me);
  if (limited) return limited;
  const body = await validateBody(req, evalSchema);
  if (body instanceof NextResponse) return body;
  if (body.subjectId === me) return NextResponse.json({ error: "You cannot run monitoring on your own account." }, { status: 403, headers });
  const account = await getAccountDurable(body.subjectId);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404, headers });
  const rows = inWindow(
    account.transactions.map((t) => ({ id: t.id, direction: t.direction, amountUsd: t.amountUsd, status: t.status, timestamp: t.timestamp, category: t.category, chain: t.chain })),
    body.from,
    body.to
  );
  const alerts = evaluate(body.subjectId, rows);
  let opened = 0;
  if (!body.dryRun) {
    try {
      for (const a of alerts) {
        const r = await insertCaseIfAbsent(
          newCase({ sourceKey: a.key, type: "monitoring_alert", subjectType: "individual", subjectId: body.subjectId, title: a.title, severity: a.severity, refs: { ruleId: a.ruleId, ruleVersion: a.ruleVersion, transactionIds: a.transactionIds }, actor: "monitoring", note: a.explanation })
        );
        if (r.created) opened++;
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof CaseStoreUnavailable ? e.message : "Alerts could not be recorded.", alerts }, { status: 503, headers });
    }
  }
  audit("compliance.monitoring_evaluated", me, { subjectId: body.subjectId, transactions: rows.length, alerts: alerts.length, opened, dryRun: body.dryRun });
  return NextResponse.json({ evaluated: rows.length, alerts, opened, dryRun: body.dryRun }, { headers });
}
