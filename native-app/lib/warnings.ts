import { colors } from "./theme";

// ---------------------------------------------------------------------------
// Risk disclosures shared by every money screen.
//
// Warnings are DATA, not markup. Returned from a pure function and rendered by
// one component, so the swap screen and the send screen cannot drift in how
// severe a thing looks, and the set is unit-testable without mounting anything.
//
// Ordered most severe first, so a surface that shows only the first item still
// shows the most important one.
// ---------------------------------------------------------------------------

export type WarningLevel = "info" | "warn" | "danger";

export interface MoneyWarning {
  id: string;
  level: WarningLevel;
  title: string;
  detail: string;
}

export const WARNING_COLOR: Record<WarningLevel, string> = {
  info: colors.textDim,
  warn: colors.warning,
  danger: colors.accent,
};

export const severity = (l: WarningLevel): number => (l === "danger" ? 2 : l === "warn" ? 1 : 0);

/** Most severe first; stable within a level so the order does not flicker. */
export function bySeverity(warnings: MoneyWarning[]): MoneyWarning[] {
  return [...warnings].sort((a, b) => severity(b.level) - severity(a.level));
}
