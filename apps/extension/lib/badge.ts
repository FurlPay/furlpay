// Toolbar badge text. Pure formatting, kept out of the service worker so it is
// testable without pulling in the MV3 globals.
//
// The badge is permanently visible chrome: it survives every screen share,
// screenshot and over-the-shoulder glance, and it renders the user's entire net
// worth. Showing it is a sensible default; being unable to turn it off is not.

/** Storage key for the "show balance on the toolbar icon" preference
 *  (browser.storage.local). Written by the popup's Settings tab, read by the
 *  background poller. Absent means on. */
export const BADGE_BALANCE_KEY = "prefBadgeBalance";

/** What the badge shows when the balance is masked. Deliberately constant
 *  across every amount — a mask that varied with magnitude would still leak it. */
export const MASKED_BADGE = "•";

/**
 * Chrome truncates badge text past 4 characters — format to always fit.
 *
 * Every band boundary is set where the NEXT band's rounding would overflow,
 * not at the round decimal. That distinction is the whole correctness story:
 * boundaries on the raw value let rounding push a label one character over,
 * and Chrome truncates silently rather than erroring, so the badge just
 * quietly shows a wrong number. $9,999 rendered "10.0k" → cut to "10.0";
 * $10M rendered "10000k" → cut to "1000", a hundredfold understatement.
 *
 * Verified ≤4 characters across the magnitude sweep in __tests__/badge.test.ts.
 */
export function badgeLabel(usd: number): string {
  if (!Number.isFinite(usd)) return "";
  const n = Math.max(0, usd);
  if (n >= 999_500_000) return ">1B"; // past the point the badge can say anything useful
  if (n >= 9_950_000) return `${Math.round(n / 1_000_000)}M`; // "10M".."999M"
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`; // "1.0M".."9.9M"
  if (n >= 99_950) return `${Math.round(n / 1000)}k`; // "100k".."999k"
  if (n >= 9_950) return `${(n / 1000).toFixed(0)}k`; // "10k".."99k"
  if (n >= 999.5) return `${(n / 1000).toFixed(1)}k`; // "1.0k".."9.9k"
  return `$${Math.round(n)}`; // "$0".."$999"
}

/** Badge text for a net worth, honoring the user's masking preference. */
export function badgeTextFor(usd: number, show: boolean): string {
  return show ? badgeLabel(usd) : MASKED_BADGE;
}
