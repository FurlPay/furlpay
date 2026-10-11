// ---------------------------------------------------------------------------
// Derive compliance cases from the events that already exist (pure planning +
// an idempotent apply). Sources today:
//
//   onboarding review submitted          → kyb_review       (medium)
//   potential sanctions match            → sanctions_match  (high)
//   confirmed sanctions match            → sanctions_match  (critical)
//
// Each case's sourceKey names exactly one underlying event, so running the sync
// any number of times opens each case once. When the underlying decision is
// taken in the onboarding review, the case is resolved from the source rather
// than left open forever.
// ---------------------------------------------------------------------------

import type { OnboardingState } from "@/lib/settlement/onboarding";
import { newCase, resolveFromSource, isOpen, type ComplianceCase, type Resolution } from "./cases";
import { insertCasesIfAbsent, listCases, updateCase } from "./caseStore";

export type PlannedCase = Parameters<typeof newCase>[0];
export type SourceOutcome = { sourceKey: string; resolution: Resolution; reason: string };

const name = (s: OnboardingState) => s.business?.legalName ?? "Unnamed business";

export function planFromOnboarding(ownerId: string, s: OnboardingState): { open: PlannedCase[]; resolved: SourceOutcome[] } {
  const open: PlannedCase[] = [];
  const resolved: SourceOutcome[] = [];
  const r = s.review;
  if (r?.submittedAt) {
    const key = `onboarding:${ownerId}:review:${r.submittedAt}`;
    if (r.status === "pending") {
      open.push({ sourceKey: key, type: "kyb_review", subjectType: "business", subjectId: ownerId, title: `KYB review — ${name(s)}`, severity: "medium", refs: { onboardingOwner: ownerId }, actor: "system", note: "Business onboarding submitted for compliance review." });
    } else if (r.status === "approved" || r.status === "rejected" || r.status === "changes_requested") {
      resolved.push({ sourceKey: key, resolution: r.status === "rejected" ? "confirmed" : "source_resolved", reason: `Onboarding review ${r.status.replace("_", " ")}${r.reason ? `: ${r.reason}` : ""}` });
    }
  }
  const sc = s.screening;
  if (sc?.requestKey && (sc.status === "potential_match" || sc.status === "confirmed_match" || sc.status === "cleared_by_review")) {
    const key = `screening:${ownerId}:${sc.requestKey}`;
    const title = `Sanctions screening — ${name(s)} (${sc.matches.length} potential match${sc.matches.length === 1 ? "" : "es"})`;
    const top = sc.matches.reduce((m, x) => Math.max(m, x.score), 0);
    if (sc.status === "potential_match") {
      open.push({ sourceKey: key, type: "sanctions_match", subjectType: "business", subjectId: ownerId, title, severity: "high", riskScore: top || null, refs: { onboardingOwner: ownerId, screeningKey: sc.requestKey }, actor: "system", note: `${sc.list}: ${sc.matches.map((m) => `${m.name} (${Math.round(m.score * 100)}%)`).join(", ")}` });
    } else if (sc.status === "confirmed_match") {
      // A confirmed match keeps a case even if it was decided before the sync ran.
      open.push({ sourceKey: key, type: "sanctions_match", subjectType: "business", subjectId: ownerId, title, severity: "critical", riskScore: top || null, refs: { onboardingOwner: ownerId, screeningKey: sc.requestKey }, actor: "system", note: "Match confirmed in onboarding review." });
      resolved.push({ sourceKey: key, resolution: "confirmed", reason: `Match confirmed by ${sc.review?.by ?? "compliance"}: ${sc.review?.reason ?? ""}`.trim() });
    } else {
      resolved.push({ sourceKey: key, resolution: "false_positive", reason: `Cleared by ${sc.review?.by ?? "compliance"}: ${sc.review?.reason ?? ""}`.trim() });
    }
  }
  return { open, resolved };
}

/** Apply a plan idempotently. Returns how many cases were opened and resolved. */
export async function syncOnboardingCases(rows: readonly { ownerId: string; state: OnboardingState }[]): Promise<{ opened: number; resolved: number }> {
  let resolvedCount = 0;
  const outcomes = new Map<string, SourceOutcome>();
  const planned = new Map<string, ComplianceCase>();
  for (const { ownerId, state } of rows) {
    const plan = planFromOnboarding(ownerId, state);
    for (const p of plan.open) planned.set(p.sourceKey, newCase(p));
    for (const o of plan.resolved) outcomes.set(o.sourceKey, o);
  }
  const opened = await insertCasesIfAbsent([...planned.values()]);
  if (outcomes.size) {
    // A case an officer reopened is theirs: the source decision no longer closes it.
    const open = (await listCases({ status: ["OPEN", "TRIAGED", "ASSIGNED", "INVESTIGATING", "ESCALATED", "DECISION_PENDING"], limit: 500 })).filter(
      (c) => outcomes.has(c.sourceKey) && !c.events.some((e) => e.action === "reopen")
    );
    for (const c of open) {
      const o = outcomes.get(c.sourceKey)!;
      const after = await updateCase(c.id, (cur: ComplianceCase) => (isOpen(cur) ? resolveFromSource(cur, o.resolution, o.reason) : cur));
      if (after.version !== c.version) resolvedCount++; // count only cases this sync actually resolved
    }
  }
  return { opened, resolved: resolvedCount };
}
