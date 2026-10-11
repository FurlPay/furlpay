// ---------------------------------------------------------------------------
// Compliance case management — domain model (pure; persistence in caseStore).
//
// One case per underlying event: every case carries a `sourceKey` that is
// unique in storage, so re-deriving cases from the same review, screening hit
// or monitoring alert never creates a duplicate.
//
// Tenancy: FurlPay is a single compliance operator. Cases are visible only to
// compliance officers; a case's subject (the applicant) never sees it, and an
// officer can never act on a case about themselves.
// ---------------------------------------------------------------------------

export const CASE_TYPES = [
  "kyc_review",
  "kyb_review",
  "sanctions_match",
  "pep_match",
  "adverse_media",
  "fraud",
  "monitoring_alert",
  "travel_rule",
  "wallet_screening",
  "settlement_hold",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = ["OPEN", "TRIAGED", "ASSIGNED", "INVESTIGATING", "ESCALATED", "DECISION_PENDING", "RESOLVED", "CLOSED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RESOLUTIONS = ["no_action", "false_positive", "confirmed", "account_restricted", "reported", "source_resolved"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type CaseEvent = {
  at: string;
  actor: string;
  action: string;
  from?: CaseStatus;
  to?: CaseStatus;
  note?: string;
};

export type ComplianceCase = {
  id: string;
  sourceKey: string;
  type: CaseType;
  subjectType: "business" | "individual" | "transaction" | "wallet";
  subjectId: string;
  title: string;
  severity: Severity;
  status: CaseStatus;
  assignee: string | null;
  slaDueAt: string;
  escalationLevel: number;
  riskScore: number | null;
  resolution: Resolution | null;
  decisionReason: string | null;
  /** Links to the evidence the case is about (onboarding owner, rule, transactions). */
  refs: { onboardingOwner?: string; ruleId?: string; ruleVersion?: number; transactionIds?: string[]; screeningKey?: string };
  createdAt: string;
  updatedAt: string;
  version: number;
  events: CaseEvent[];
};

/** Hours to the SLA deadline, by severity. */
export const SLA_HOURS: Record<Severity, number> = { critical: 24, high: 72, medium: 168, low: 336 };

export function slaDueAt(severity: Severity, createdAt: string): string {
  return new Date(Date.parse(createdAt) + SLA_HOURS[severity] * 3_600_000).toISOString();
}

export function slaState(c: Pick<ComplianceCase, "slaDueAt" | "status">, now = Date.now()): "met" | "on_track" | "due_soon" | "overdue" {
  if (c.status === "RESOLVED" || c.status === "CLOSED") return "met";
  const left = Date.parse(c.slaDueAt) - now;
  if (left < 0) return "overdue";
  return left < 24 * 3_600_000 ? "due_soon" : "on_track";
}

export const ACTIONS = ["triage", "assign", "start", "escalate", "request_decision", "resolve", "close", "reopen", "note"] as const;
export type CaseAction = (typeof ACTIONS)[number];

const OPEN_STATES: CaseStatus[] = ["OPEN", "TRIAGED", "ASSIGNED", "INVESTIGATING", "ESCALATED", "DECISION_PENDING"];

/** Allowed status transitions per action. `note` changes nothing. */
export const TRANSITIONS: Record<Exclude<CaseAction, "note">, { from: CaseStatus[]; to: CaseStatus }> = {
  triage: { from: ["OPEN"], to: "TRIAGED" },
  assign: { from: ["OPEN", "TRIAGED", "ASSIGNED", "INVESTIGATING", "ESCALATED", "DECISION_PENDING"], to: "ASSIGNED" },
  start: { from: ["ASSIGNED", "ESCALATED"], to: "INVESTIGATING" },
  escalate: { from: ["TRIAGED", "ASSIGNED", "INVESTIGATING", "DECISION_PENDING"], to: "ESCALATED" },
  request_decision: { from: ["INVESTIGATING", "ESCALATED"], to: "DECISION_PENDING" },
  resolve: { from: ["INVESTIGATING", "ESCALATED", "DECISION_PENDING"], to: "RESOLVED" },
  close: { from: ["RESOLVED"], to: "CLOSED" },
  reopen: { from: ["RESOLVED", "CLOSED"], to: "INVESTIGATING" },
};

export function allowedActions(c: Pick<ComplianceCase, "status">): CaseAction[] {
  const out = (Object.keys(TRANSITIONS) as Exclude<CaseAction, "note">[]).filter((a) => TRANSITIONS[a].from.includes(c.status));
  return [...out, "note"];
}

export type ActionInput =
  | { action: "triage"; severity?: Severity; reason?: string }
  | { action: "assign"; assignee: string; reason?: string }
  | { action: "start"; reason?: string }
  | { action: "escalate"; reason: string }
  | { action: "request_decision"; reason?: string }
  | { action: "resolve"; resolution: Exclude<Resolution, "source_resolved">; reason: string }
  | { action: "close"; reason: string }
  | { action: "reopen"; reason: string }
  | { action: "note"; reason: string };

export class CaseRefusal extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}

/**
 * Apply an officer action. Pure: returns the next case or throws CaseRefusal.
 * Authorisation that needs I/O (is the assignee an officer?) is checked by the caller.
 */
export function applyAction(c: ComplianceCase, input: ActionInput, actor: string, now = new Date().toISOString()): ComplianceCase {
  if (c.subjectId === actor) throw new CaseRefusal("You cannot act on a case about yourself.", 403);
  const next: ComplianceCase = { ...c, refs: { ...c.refs }, events: [...c.events], updatedAt: now, version: c.version + 1 };
  const event: CaseEvent = { at: now, actor, action: input.action, note: "reason" in input ? input.reason : undefined };
  if (input.action === "note") {
    if (!input.reason?.trim()) throw new CaseRefusal("A note needs text.", 400);
    next.events.push(event);
    return next;
  }
  const t = TRANSITIONS[input.action];
  if (!t.from.includes(c.status)) throw new CaseRefusal(`Cannot ${input.action.replace("_", " ")} a case that is ${c.status}.`);
  switch (input.action) {
    case "triage":
      if (input.severity && input.severity !== c.severity) {
        next.severity = input.severity;
        next.slaDueAt = slaDueAt(input.severity, c.createdAt);
      }
      break;
    case "assign":
      next.assignee = input.assignee;
      event.note = `Assigned to ${input.assignee}${input.reason ? ` — ${input.reason}` : ""}`;
      break;
    case "escalate":
      next.escalationLevel = c.escalationLevel + 1;
      break;
    case "resolve":
      next.resolution = input.resolution;
      next.decisionReason = input.reason;
      break;
    case "reopen":
      next.resolution = null;
      next.decisionReason = null;
      break;
  }
  next.status = t.to;
  event.from = c.status;
  event.to = t.to;
  next.events.push(event);
  return next;
}

/** A new case from an underlying event. */
export function newCase(input: {
  sourceKey: string;
  type: CaseType;
  subjectType: ComplianceCase["subjectType"];
  subjectId: string;
  title: string;
  severity: Severity;
  riskScore?: number | null;
  refs?: ComplianceCase["refs"];
  actor: string;
  note?: string;
  now?: string;
}): ComplianceCase {
  const now = input.now ?? new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sourceKey: input.sourceKey,
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    title: input.title,
    severity: input.severity,
    status: "OPEN",
    assignee: null,
    slaDueAt: slaDueAt(input.severity, now),
    escalationLevel: 0,
    riskScore: input.riskScore ?? null,
    resolution: null,
    decisionReason: null,
    refs: input.refs ?? {},
    createdAt: now,
    updatedAt: now,
    version: 1,
    events: [{ at: now, actor: input.actor, action: "opened", to: "OPEN", note: input.note }],
  };
}

/** The underlying event was decided elsewhere (e.g. the onboarding review): close the loop. */
export function resolveFromSource(c: ComplianceCase, resolution: Resolution, reason: string, now = new Date().toISOString()): ComplianceCase {
  if (!OPEN_STATES.includes(c.status)) return c;
  return {
    ...c,
    status: "RESOLVED",
    resolution,
    decisionReason: reason,
    updatedAt: now,
    version: c.version + 1,
    events: [...c.events, { at: now, actor: "system", action: "source_resolved", from: c.status, to: "RESOLVED", note: reason }],
  };
}

export const isOpen = (c: Pick<ComplianceCase, "status">) => OPEN_STATES.includes(c.status);
