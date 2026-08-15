import type { PaymentRow, PaymentStatus } from "@/lib/paymentsDb";
import type { UserAccount } from "@/lib/store";
import type { Chain } from "@furlpay/types";
import { CHAINS, addressKey, chainKind, findContactByAddress } from "@/lib/contacts";
import { classifyAddress } from "@/lib/addressValidation";

// ---------------------------------------------------------------------------
// "Recently paid" — derived from the payments ledger, never invented.
//
// This list exists to remove the most common re-payment mistake: retyping (or
// re-pasting) an address you already paid last week. That only works if every
// entry is somewhere the user REALLY sent money, so the source is the payments
// table (migration 0009) and nothing else. When that table is absent the answer
// is an empty list flagged `durable: false` — a deployment without the
// migration has no payment history, and manufacturing plausible-looking
// recipients for it would be worse than showing nothing.
// ---------------------------------------------------------------------------

/**
 * Statuses excluded from suggestions.
 *
 * `blocked` is a compliance decision — re-offering that recipient one tap from
 * the amount field actively works against the control that stopped it.
 * `expired` is an intent that lapsed without the user completing it, which is
 * not evidence they meant to pay that address. Everything else (settled,
 * refunded, and intents still in flight) reflects a real, deliberate send.
 */
const EXCLUDED_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(["blocked", "expired"]);

export interface RecentRecipient {
  address: string;
  chain: Chain;
  /** ISO timestamp of the most recent payment to this address. */
  lastPaidAt: string;
  /** How many payments in the window went here — the "regular payee" signal. */
  count: number;
  /** Set when this address is already in the address book. */
  contact?: { id: string; name: string; avatarColor: string };
}

const isKnownChain = (value: string): value is Chain =>
  (CHAINS as readonly string[]).includes(value);

/** When the payment happened, best available. `settled_at` is the truth for a
 *  completed payment; `created_at` is all an in-flight intent has. */
function paidAt(row: PaymentRow): string | null {
  return row.settled_at ?? row.created_at ?? null;
}

/**
 * Collapse a payment history into distinct recipients, most recent first.
 *
 * Rows whose recipient is not payable on the chain they were sent on are
 * DROPPED rather than repaired. Such a row cannot be re-sent to, so offering it
 * would put a guaranteed failure at the top of the send sheet.
 */
export function summarizeRecentRecipients(
  account: UserAccount,
  rows: PaymentRow[],
  limit = Number.POSITIVE_INFINITY
): RecentRecipient[] {
  const byAddress = new Map<string, RecentRecipient>();

  for (const row of rows) {
    if (EXCLUDED_STATUSES.has(row.status)) continue;

    // Settlement chain wins: that is where the money actually landed. The
    // source chain is only what the payer funded from.
    const rawChain = row.settlement_chain ?? row.source_chain;
    if (!rawChain || !isKnownChain(rawChain)) continue;

    const address = row.recipient?.trim();
    if (!address) continue;
    if (classifyAddress(address) !== chainKind(rawChain)) continue;

    const at = paidAt(row);
    if (!at) continue;

    const key = addressKey(address, rawChain);
    const existing = byAddress.get(key);
    if (existing) {
      existing.count += 1;
      if (at > existing.lastPaidAt) existing.lastPaidAt = at;
      continue;
    }

    const contact = findContactByAddress(account, address, rawChain);
    byAddress.set(key, {
      address,
      chain: rawChain,
      lastPaidAt: at,
      count: 1,
      ...(contact
        ? { contact: { id: contact.id, name: contact.name, avatarColor: contact.avatarColor } }
        : {}),
    });
  }

  return [...byAddress.values()]
    .sort((a, b) => b.lastPaidAt.localeCompare(a.lastPaidAt))
    .slice(0, limit);
}

/** Recents payable on `chain`, for the send sheet's current network. */
export function recentsForChain(recents: RecentRecipient[], chain: Chain): RecentRecipient[] {
  const kind = chainKind(chain);
  return recents.filter((r) => chainKind(r.chain) === kind);
}
