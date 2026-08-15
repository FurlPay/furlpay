import type { UserAccount } from "@/lib/store";
import { sendEmail } from "@/lib/email";
import { paymentReceiptEmail, transactionDeclinedEmail } from "@/lib/emailTemplates";
import { sendPushToUser } from "@/lib/push";
import { sendFcmToUser } from "@/lib/fcm";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Transaction notifications — one call site per money route, three channels.
//
// The account already carries notification preferences
// (notifications.transactions / .security); before this module existed they
// gated nothing, because nothing sent. Only the card-auth webhook ever
// notified anyone — a declined card spend, a transfer, an order: silence.
//
// Channel fan-out per event: web push (VAPID subscriptions), native push
// (FCM devices), and email (Resend, suppression-aware). Every send is
// fire-and-forget from the money path — a notification failure must never
// fail or slow the transaction it describes, so callers invoke this WITHOUT
// awaiting and this module never throws.
// ---------------------------------------------------------------------------

export type TransactionEventKind = "card_approved" | "card_declined" | "transfer_out";

export interface TransactionEvent {
  kind: TransactionEventKind;
  amountUsd: number;
  /** Merchant or recipient — whatever the user would recognize. */
  counterparty: string;
  dateIso: string;
  /** Card label ("Virtual · Visa") when the event is card-borne. */
  cardLabel?: string;
  /** Merchant category code, when the rail supplied one. */
  mcc?: string;
  /** Decline reasons from the policy engine — shown verbatim; the engine
   *  already writes them for humans ("Exceeds per-purchase limit ($500)"). */
  reasons?: string[];
}

/** Which preference toggle governs an event. Pure, so the gating — the part
 *  that must not silently regress — is unit-testable without any sender.
 *  Declines are security events, not activity: a user who muted routine
 *  transaction receipts still expects to hear that a charge was REFUSED,
 *  because an unexpected decline is how card fraud usually announces itself. */
export function prefFor(kind: TransactionEventKind): "transactions" | "security" {
  return kind === "card_declined" ? "security" : "transactions";
}

export function shouldNotify(
  prefs: { transactions: boolean; security: boolean } | undefined,
  kind: TransactionEventKind
): boolean {
  if (!prefs) return false; // no recorded preferences → send nothing, not everything
  return prefs[prefFor(kind)] === true;
}

function pushCopy(ev: TransactionEvent): { title: string; body: string; url: string } {
  const amount = `$${ev.amountUsd.toFixed(2)}`;
  switch (ev.kind) {
    case "card_declined":
      return {
        title: "Card payment declined",
        body: `${amount} to ${ev.counterparty} was declined${ev.reasons?.[0] ? ` — ${ev.reasons[0]}` : ""}`,
        url: "/cards",
      };
    case "card_approved":
      return { title: "Card payment", body: `${amount} to ${ev.counterparty}`, url: "/cards" };
    case "transfer_out":
      return { title: "Transfer sent", body: `${amount} to ${ev.counterparty}`, url: "/dashboard" };
  }
}

/**
 * Fan a transaction event out to every channel the user's preferences allow.
 * Never throws; never awaited by money routes.
 */
export async function notifyTransaction(account: UserAccount, ev: TransactionEvent): Promise<void> {
  try {
    if (!shouldNotify(account.user.notifications, ev.kind)) return;
    const userId = account.user.id;
    const copy = pushCopy(ev);

    const email =
      ev.kind === "card_declined"
        ? transactionDeclinedEmail({
            name: account.user.name,
            amountUsd: ev.amountUsd,
            merchant: ev.counterparty,
            cardLabel: ev.cardLabel,
            mcc: ev.mcc,
            reasons: ev.reasons ?? [],
            dateIso: ev.dateIso,
          })
        : paymentReceiptEmail({
            name: account.user.name,
            amountUsd: ev.amountUsd,
            description:
              ev.kind === "transfer_out"
                ? `Transfer to ${ev.counterparty}`
                : `Card purchase at ${ev.counterparty}`,
            dateIso: ev.dateIso,
          });

    // Channels are independent: one failing must not stop the others, so each
    // settles on its own and failures are logged rather than propagated.
    await Promise.allSettled([
      sendPushToUser(userId, { ...copy, tag: `tx-${ev.kind}` }),
      sendFcmToUser(userId, copy),
      account.user.email
        ? sendEmail({ to: account.user.email, subject: email.subject, html: email.html, text: email.text })
        : Promise.resolve(),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          log.warn("transaction notification channel failed", { kind: ev.kind, error: String(r.reason) });
        }
      }
    });
  } catch (e) {
    // Notification code must be incapable of breaking a money route.
    log.warn("notifyTransaction failed", { kind: ev.kind, error: String(e) });
  }
}
