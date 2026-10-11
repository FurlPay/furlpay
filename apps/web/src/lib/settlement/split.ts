// Split-rule arithmetic shared by the settlement editor (immediate feedback)
// and its tests. Pure and deterministic. The server's settlementSchema stays
// authoritative: nothing here is trusted on the way in.

export const MAX_RULES = 10;

/**
 * Parse what the user typed into a percentage field. Empty or non-numeric input
 * becomes NaN (an explicit "no value" that can never total 100); anything else
 * is kept as typed, including out-of-range or fractional values, so the editor
 * can say exactly what is wrong instead of silently changing it.
 */
export function parsePercent(raw: string): number {
  const t = raw.trim();
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

/** Why one percentage is not acceptable, or null when it is a whole number 0–100. */
export function percentError(p: number): string | null {
  if (!Number.isFinite(p)) return "Enter a percentage.";
  if (!Number.isInteger(p)) return "Use whole percentages.";
  if (p < 0) return "Percentages cannot be negative.";
  if (p > 100) return "A rule cannot exceed 100%.";
  return null;
}

export type SplitSummary = {
  /** Sum of the finite percentages (what the user sees). */
  total: number;
  /** total === 100 and every rule is a whole number 0–100. */
  valid: boolean;
  /** 100 − total when under-allocated, else 0. */
  remaining: number;
  /** total − 100 when over-allocated, else 0. */
  over: number;
  /** Index → message for each malformed rule. */
  ruleErrors: Record<number, string>;
};

export function summarize(rules: readonly { percent: number }[]): SplitSummary {
  const ruleErrors: Record<number, string> = {};
  let total = 0;
  rules.forEach((r, i) => {
    const e = percentError(r.percent);
    if (e) ruleErrors[i] = e;
    if (Number.isFinite(r.percent)) total += r.percent;
  });
  total = Math.round(total * 100) / 100;
  const malformed = Object.keys(ruleErrors).length > 0;
  return { total, valid: rules.length > 0 && !malformed && total === 100, remaining: total < 100 ? Math.round((100 - total) * 100) / 100 : 0, over: total > 100 ? Math.round((total - 100) * 100) / 100 : 0, ruleErrors };
}

/** Percentage for a newly added rule: whatever is unallocated, never pushing the total past 100. */
export function nextRulePercent(rules: readonly { percent: number }[]): number {
  const { total } = summarize(rules);
  return Math.max(0, Math.min(100, Math.floor(100 - total)));
}

/** Preview amounts for an example payment; malformed rules contribute nothing. */
export function previewAmounts(rules: readonly { percent: number }[], amount: number): number[] {
  const a = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return rules.map((r) => (percentError(r.percent) ? 0 : (a * r.percent) / 100));
}
