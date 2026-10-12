// Held agent payments — read-only in the extension.
//
// GET /api/control-plane/approvals lists the payments a policy held for a
// person. Deciding one needs a fresh passkey or OTP step-up bound to the
// session, and a passkey cannot be asserted from the extension's origin, so
// the extension shows the queue and hands off to the web approval page. It
// never posts a decision.
//
// Mirrors native-app/lib/heldPayments.ts: amounts are the server's amountMajor,
// and an asset the server could not scale is shown in atomic units, not
// re-scaled by a guess here.

export interface HeldPayment {
  id: string;
  deadline: string | null;
  onTimeout: "HOLD" | "DENY";
  amount: string;
  amountMajor: string | null;
  asset: string;
  payee: string;
  reason: string | null;
}

/** Where a held payment is reviewed and decided. */
export const HELD_PAYMENTS_PATH = "/settlement/payouts/approvals";

/** Server codes meaning "this account has no approval queue", not a failure. */
const NO_QUEUE = new Set(["no_organization", "organization_inactive"]);

export function hasNoQueue(error: string): boolean {
  return NO_QUEUE.has(error);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseHeldPayments(raw: unknown): HeldPayment[] {
  const list = (raw as { approvals?: unknown } | null)?.approvals;
  if (!Array.isArray(list)) return [];
  const out: HeldPayment[] = [];
  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    const p = (a.payment ?? {}) as Record<string, unknown>;
    const id = str(a.id);
    const amount = str(p.amount);
    const asset = str(p.asset);
    // A card with no amount is not one a person should be asked to act on.
    if (!id || !amount || !/^\d+$/.test(amount) || !asset) continue;
    out.push({
      id,
      deadline: str(a.deadline),
      onTimeout: a.onTimeout === "HOLD" ? "HOLD" : "DENY",
      amount,
      amountMajor: str(p.amountMajor),
      asset,
      payee: str(p.recipientDestination) ?? str(p.merchantDomain) ?? str(p.recipientId) ?? "Unknown recipient",
      reason: str(p.reason),
    });
  }
  return out;
}

/** "1,250.50 USDC" — grouped, trailing zeros trimmed to cents, never rounded. */
export function heldAmountLabel(h: Pick<HeldPayment, "amount" | "amountMajor" | "asset">): string {
  if (h.amountMajor === null) return `${h.amount} atomic units (${h.asset})`;
  const [whole = "", fraction = ""] = h.amountMajor.split(".");
  let shown = fraction.replace(/0+$/, "");
  if (shown.length < 2) shown = fraction.slice(0, 2);
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${shown ? `.${shown}` : ""} ${h.asset}`;
}
