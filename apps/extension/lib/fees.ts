// Fee-scanner arithmetic + total-selection heuristics, extracted from the
// content script so the money math is unit-testable. The DOM walk stays in
// fee-scanner.content.ts; everything it feeds into lives here.

export const CHECKOUT_HINTS = /checkout|payment|cart|billing|order|book(ing)?/i;
export const CARD_FEE_PCT = 0.029;
export const CARD_FEE_FIXED = 0.3;
export const FURLPAY_FEE_PCT = 0.005;

export interface FeeComparison {
  cardFee: number;
  furlFee: number;
  saving: number;
}

/** Typical card processing cost vs FurlPay's flat 0.5% for a given total. */
export function compareFees(total: number): FeeComparison {
  const cardFee = total * CARD_FEE_PCT + CARD_FEE_FIXED;
  const furlFee = total * FURLPAY_FEE_PCT;
  return { cardFee, furlFee, saving: cardFee - furlFee };
}

export interface AmountCandidate {
  value: number;
  /** True when the surrounding text mentions total / amount due / pay. */
  weighted: boolean;
}

const AMOUNT_RE = /(?:\$|USD\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
const TOTAL_CONTEXT_RE = /total|amount due|pay/;

/** Currency amounts in one text node, bounds-checked ($0 < v ≤ $100k). */
export function extractAmounts(text: string, context: string): AmountCandidate[] {
  const out: AmountCandidate[] = [];
  const re = new RegExp(AMOUNT_RE.source, "g"); // fresh lastIndex per call
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
    out.push({ value, weighted: TOTAL_CONTEXT_RE.test(context.slice(0, 120).toLowerCase()) });
  }
  return out;
}

/** The order total: the largest amount near a "total" label when any exists,
 *  otherwise the largest amount on the page. Null when nothing qualified. */
export function pickTotal(candidates: AmountCandidate[]): number | null {
  if (!candidates.length) return null;
  const weighted = candidates.filter((c) => c.weighted);
  const pool = weighted.length ? weighted : candidates;
  return Math.max(...pool.map((c) => c.value));
}
