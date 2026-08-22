/**
 * The page numbers a pager should render; `null` is an ellipsis.
 *
 * Lives in lib rather than beside the component because it is pure arithmetic
 * with several edge cases worth pinning, and the test runner is node-only (see
 * vitest.config.ts) — a spec cannot import a .tsx file. Logic that deserves a
 * test does not belong inside a component.
 *
 * The rules:
 *   - the first and last page are always reachable
 *   - the current page always keeps a neighbour on each side where one exists
 *   - an ellipsis is used only when it replaces MORE than one page, because
 *     "1 … 3" is longer than "1 2 3" and conceals nothing
 */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) out.push(start === 3 ? 2 : null);
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pageCount - 1) out.push(end === pageCount - 2 ? pageCount - 1 : null);

  out.push(pageCount);
  return out;
}
