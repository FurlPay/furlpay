// Local comparison of an external statement (bank or ERP export) against the
// FurlPay journal. Amounts are integer minor units (cents). A match is an
// ID-and-amount comparison, not certified reconciliation; the tolerance is the
// user's explicit choice and every row within it is labelled as such.

export type MatchResult = "matched" | "within_tolerance" | "amount_mismatch" | "missing_in_statement" | "missing_in_ledger";
export type MatchRow = {
  id: string;
  ledgerAmount: number | null;
  statementAmount: number | null;
  /** statement − ledger, in cents; null when one side is missing. */
  difference: number | null;
  result: MatchResult;
};

export const RESULT_LABEL: Record<MatchResult, string> = {
  matched: "Matched",
  within_tolerance: "Within tolerance",
  amount_mismatch: "Amount differs",
  missing_in_statement: "Not in statement",
  missing_in_ledger: "Not in FurlPay",
};

/** At most $1,000.00 either way: a wider band stops being a reconciliation. */
export const MAX_TOLERANCE_CENTS = 100_000;

export function reconcile(ledger: Map<string, number>, statement: Map<string, number>, toleranceCents = 0): MatchRow[] {
  if (!Number.isInteger(toleranceCents) || toleranceCents < 0 || toleranceCents > MAX_TOLERANCE_CENTS) throw new Error("Invalid tolerance");
  const ids = [...new Set([...ledger.keys(), ...statement.keys()])];
  return ids.map((id) => {
    const l = ledger.get(id) ?? null;
    const s = statement.get(id) ?? null;
    if (l === null) return { id, ledgerAmount: null, statementAmount: s, difference: null, result: "missing_in_ledger" };
    if (s === null) return { id, ledgerAmount: l, statementAmount: null, difference: null, result: "missing_in_statement" };
    const difference = s - l;
    const result: MatchResult = difference === 0 ? "matched" : Math.abs(difference) <= toleranceCents ? "within_tolerance" : "amount_mismatch";
    return { id, ledgerAmount: l, statementAmount: s, difference, result };
  });
}

export type MatchFilter = "all" | "matched" | "exceptions";
export const isMatch = (r: MatchRow) => r.result === "matched" || r.result === "within_tolerance";

export function filterRows(rows: MatchRow[], filter: MatchFilter, query: string): MatchRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (filter === "all" || (filter === "matched") === isMatch(r)) && (!q || r.id.toLowerCase().includes(q)));
}
