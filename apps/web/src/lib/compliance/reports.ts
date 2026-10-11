// ---------------------------------------------------------------------------
// Compliance report exports (pure CSV builders over stored records).
//
// Redaction is by construction: the column lists below never include dates of
// birth, emails, phone numbers, ID numbers, document names or document
// contents. Subjects are referenced by their account id and business legal
// name. Cells go through csvCell (formula-injection safe).
// ---------------------------------------------------------------------------

import { csvDocument } from "@/lib/csv";
import type { OnboardingState } from "@/lib/settlement/onboarding";
import type { ComplianceCase } from "./cases";

export const REPORT_TYPES = ["cases", "case_audit_trail", "monitoring_alerts", "sanctions_screening", "kyb_reviews", "investigator_activity"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  cases: "Case management report",
  case_audit_trail: "Compliance audit trail (case events)",
  monitoring_alerts: "Transaction monitoring report",
  sanctions_screening: "AML / sanctions screening report",
  kyb_reviews: "KYB verification report",
  investigator_activity: "Investigator activity report",
};

export type Range = { from?: string; to?: string };
const within = (iso: string | undefined, r: Range) => !!iso && (!r.from || iso >= r.from) && (!r.to || iso < r.to);

export function casesReport(cases: readonly ComplianceCase[], r: Range): string {
  const rows = cases.filter((c) => within(c.createdAt, r));
  return csvDocument(
    ["case_id", "type", "subject_type", "subject_id", "title", "severity", "status", "assignee", "sla_due_at", "escalation_level", "resolution", "decision_reason", "created_at", "updated_at"],
    rows.map((c) => [c.id, c.type, c.subjectType, c.subjectId, c.title, c.severity, c.status, c.assignee ?? "", c.slaDueAt, c.escalationLevel, c.resolution ?? "", c.decisionReason ?? "", c.createdAt, c.updatedAt])
  );
}

export function auditTrailReport(cases: readonly ComplianceCase[], r: Range): string {
  const rows = cases.flatMap((c) => c.events.filter((e) => within(e.at, r)).map((e) => [e.at, c.id, c.type, e.actor, e.action, e.from ?? "", e.to ?? "", e.note ?? ""]));
  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return csvDocument(["at", "case_id", "case_type", "actor", "action", "from_status", "to_status", "note"], rows);
}

export function monitoringReport(cases: readonly ComplianceCase[], r: Range): string {
  const rows = cases.filter((c) => c.type === "monitoring_alert" && within(c.createdAt, r));
  return csvDocument(
    ["case_id", "subject_id", "rule", "rule_version", "severity", "status", "transactions", "title", "created_at"],
    rows.map((c) => [c.id, c.subjectId, c.refs.ruleId ?? "", c.refs.ruleVersion ?? "", c.severity, c.status, (c.refs.transactionIds ?? []).join(" "), c.title, c.createdAt])
  );
}

export function screeningReport(states: readonly { ownerId: string; state: OnboardingState }[], r: Range): string {
  const rows = states.flatMap(({ ownerId, state }) =>
    (state.screeningHistory ?? [])
      .filter((h) => within(h.at, r))
      .map((h) => [h.at, ownerId, state.business?.legalName ?? "", h.kind, h.trigger ?? "", h.provider, h.names ?? "", (h.matches ?? []).length, (h.matches ?? []).map((m) => `${m.name} ${Math.round(m.score * 100)}%`).join("; "), h.disposition, h.by, h.reason ?? ""])
  );
  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return csvDocument(["at", "subject_id", "business", "kind", "trigger", "list_or_provider", "names_screened", "match_count", "matches", "disposition", "by", "reason"], rows);
}

export function kybReport(states: readonly { ownerId: string; state: OnboardingState }[], r: Range): string {
  const rows = states.flatMap(({ ownerId, state }) =>
    (state.review?.history ?? []).filter((h) => within(h.at, r)).map((h) => [h.at, ownerId, state.business?.legalName ?? "", state.business?.country ?? "", h.action, h.target ?? "", h.by, h.reason ?? "", state.review?.status ?? "not_submitted", state.activation.status])
  );
  rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return csvDocument(["at", "subject_id", "business", "country", "action", "target", "by", "reason", "current_review_status", "activation"], rows);
}

export function investigatorReport(cases: readonly ComplianceCase[], r: Range): string {
  const per = new Map<string, { actions: number; resolved: number; escalated: number; notes: number }>();
  for (const c of cases)
    for (const e of c.events) {
      if (e.actor === "system" || !within(e.at, r)) continue;
      const p = per.get(e.actor) ?? { actions: 0, resolved: 0, escalated: 0, notes: 0 };
      p.actions++;
      if (e.action === "resolve") p.resolved++;
      if (e.action === "escalate") p.escalated++;
      if (e.action === "note") p.notes++;
      per.set(e.actor, p);
    }
  return csvDocument(["investigator", "actions", "resolved", "escalated", "notes"], [...per.entries()].sort().map(([k, v]) => [k, v.actions, v.resolved, v.escalated, v.notes]));
}
