// ---------------------------------------------------------------------------
// Screening history and re-screening schedule (pure).
//
// Each onboarding case keeps an append-only, bounded log of screening runs and
// the decisions taken on them. A run that never reached the provider is
// recorded as UNAVAILABLE — never as CLEAR.
//
// Re-screening intervals are policy defaults keyed on country risk. They are
// configuration to be approved by compliance, not regulatory facts.
// ---------------------------------------------------------------------------

import type { ScreeningResult } from "@/lib/settlement/onboarding";

export const DISPOSITIONS = ["CLEAR", "POTENTIAL_MATCH", "UNDER_REVIEW", "CONFIRMED_MATCH", "FALSE_POSITIVE", "ESCALATED", "UNAVAILABLE", "CLOSED"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type ScreeningTrigger = "initial" | "profile_change" | "officer_request" | "scheduled" | "retry";

export type ScreeningRecord = {
  at: string;
  kind: "run" | "decision";
  trigger?: ScreeningTrigger;
  provider: string;
  requestKey?: string;
  names?: number;
  matches?: { name: string; score: number; source: string }[];
  disposition: Disposition;
  by: string;
  reason?: string;
};

export const MAX_HISTORY = 25;

export function dispositionOf(status: ScreeningResult["status"]): Disposition {
  switch (status) {
    case "clear":
      return "CLEAR";
    case "potential_match":
      return "POTENTIAL_MATCH";
    case "cleared_by_review":
      return "FALSE_POSITIVE";
    case "confirmed_match":
      return "CONFIRMED_MATCH";
    case "failed":
      return "UNAVAILABLE";
  }
}

export function runRecord(r: ScreeningResult, trigger: ScreeningTrigger, by: string): ScreeningRecord {
  return { at: r.screenedAt, kind: "run", trigger, provider: r.list, requestKey: r.requestKey, names: r.names, matches: r.matches, disposition: dispositionOf(r.status), by };
}

export function decisionRecord(disposition: Disposition, by: string, reason: string, requestKey?: string, at = new Date().toISOString()): ScreeningRecord {
  return { at, kind: "decision", provider: "compliance review", requestKey, disposition, by, reason };
}

export function appendHistory(history: readonly ScreeningRecord[] | undefined, rec: ScreeningRecord): ScreeningRecord[] {
  return [...(history ?? []), rec].slice(-MAX_HISTORY);
}

/** Days between scheduled re-screens, by country risk level. */
export const RESCREEN_DAYS: Record<string, number> = { very_high: 90, high: 90, medium: 180, low: 365 };
const DEFAULT_DAYS = 180;

/** When the case is next due for re-screening; null if it was never screened. */
export function nextRescreenAt(lastScreenedAt: string | undefined, riskLevel: string | undefined): string | null {
  if (!lastScreenedAt) return null;
  const days = (riskLevel && RESCREEN_DAYS[riskLevel]) || DEFAULT_DAYS;
  return new Date(Date.parse(lastScreenedAt) + days * 86_400_000).toISOString();
}

export function rescreenDue(lastScreenedAt: string | undefined, riskLevel: string | undefined, now = Date.now()): boolean {
  const at = nextRescreenAt(lastScreenedAt, riskLevel);
  return at !== null && Date.parse(at) <= now;
}
