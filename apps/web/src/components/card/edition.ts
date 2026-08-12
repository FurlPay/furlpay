/** "AUGUST / 2026" — the issue stamp printed on a HoloCard.
 *
 * Deliberately not a client-only module: server components render the first
 * paint with it, and client components re-render it on mount so a statically
 * built page cannot show last quarter's month forever. Locale is pinned to
 * en-US so the server and the browser cannot disagree about the wording. */
export function editionLabel(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "long" }).toUpperCase();
  return `${month} / ${date.getFullYear()}`;
}
