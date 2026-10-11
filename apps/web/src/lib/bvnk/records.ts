import { sbRpc } from "@/lib/supabase";
import { decimalString } from "./amount";
import type { ParsedBvnkEvent } from "./webhook";
import type { BvnkTransfer } from "./schemas";

// Map verified BVNK reports onto bvnk_records rows (migration 0052). Records
// only: no ledger posting, no balance change, no payment authorisation.

export type BvnkRecordRow = {
  kind: "payin" | "payout" | "transfer" | "wallet";
  provider_id: string;
  direction: "IN" | "OUT" | "";
  reference?: string | null;
  status: string;
  method?: string | null;
  wallet_id?: string | null;
  customer_id?: string | null;
  originator_amount?: string | null;
  originator_currency?: string | null;
  beneficiary_amount?: string | null;
  beneficiary_currency?: string | null;
  processing_fee_amount?: string | null;
  processing_fee_currency?: string | null;
  customer_fee_amount?: string | null;
  customer_fee_currency?: string | null;
  conversion_rate?: string | null;
  quote_digest?: string | null;
  quote_expires_at?: string | null;
  provider_updated_at: string;
  source: "webhook" | "api";
  last_event_id?: string | null;
};

const dec = (n: number | undefined, field: string) => (n === undefined ? null : decimalString(n, field));

function fromTransfer(t: BvnkTransfer & { direction?: "IN" | "OUT" }, source: "webhook" | "api", eventId: string | null, fallbackUpdatedAt: string): BvnkRecordRow {
  return {
    kind: "transfer", provider_id: t.id, direction: t.direction ?? "", reference: t.reference, status: t.status, method: "BOOK",
    wallet_id: t.direction === "IN" ? t.beneficiary.walletId : t.originator.walletId,
    originator_amount: dec(t.originator.amount, "originator.amount"), originator_currency: t.originator.currency,
    beneficiary_amount: dec(t.beneficiary.amount, "beneficiary.amount"), beneficiary_currency: t.beneficiary.currency,
    processing_fee_amount: dec(t.fees?.processingFee?.amount, "fees.processingFee.amount"), processing_fee_currency: t.fees?.processingFee?.currency ?? null,
    conversion_rate: t.conversion?.allInRate !== undefined ? decimalString(t.conversion.allInRate, "conversion.allInRate") : null,
    quote_digest: t.conversion?.digest ?? null, quote_expires_at: t.conversion?.expiresAt ?? t.expiresAt ?? null,
    provider_updated_at: t.updatedAt ?? fallbackUpdatedAt, source, last_event_id: eventId,
  };
}

/** The row a verified event becomes, or null for events that carry no recordable state. */
export function recordFromEvent(p: ParsedBvnkEvent): BvnkRecordRow | null {
  const eventId = p.event.eventId;
  if (p.kind === "payin" || p.kind === "payout") {
    const d = p.event.data;
    return {
      kind: p.kind, provider_id: d.id, direction: d.direction, reference: d.reference ?? null, status: d.status, method: d.method,
      wallet_id: p.kind === "payin" ? d.beneficiary.walletId ?? null : d.originator.walletId ?? null,
      customer_id: p.kind === "payin" ? d.beneficiary.customerId ?? null : d.originator.customerId ?? null,
      originator_amount: dec(d.originator.amount, "originator.amount"), originator_currency: d.originator.currency,
      beneficiary_amount: dec(d.beneficiary.amount, "beneficiary.amount"), beneficiary_currency: d.beneficiary.currency,
      processing_fee_amount: dec(d.fees?.processingFee?.amount, "fees.processingFee.amount"), processing_fee_currency: d.fees?.processingFee?.currency ?? null,
      customer_fee_amount: dec(d.fees?.customerFee?.amount, "fees.customerFee.amount"), customer_fee_currency: d.fees?.customerFee?.currency ?? null,
      provider_updated_at: d.updatedAt, source: "webhook", last_event_id: eventId,
    };
  }
  if (p.kind === "transfer") return fromTransfer(p.event.data, "webhook", eventId, p.event.data.updatedAt);
  if (p.kind === "wallet") {
    const d = p.event.data;
    return { kind: "wallet", provider_id: d.id, direction: "", status: d.status, customer_id: d.customer?.id ?? null, provider_updated_at: d.updatedAt, source: "webhook", last_event_id: eventId };
  }
  return null; // customer status and unhandled events: delivery recorded in webhook_events only
}

export function recordFromTransfer(t: BvnkTransfer, now = new Date().toISOString()): BvnkRecordRow {
  return fromTransfer(t, "api", null, now);
}

export type UpsertOutcome = "inserted" | "updated" | "stale" | "conflict";

/**
 * Apply one report (migration 0052). "stale": older than, or identical to, what
 * is stored. "conflict": not applied, because it contradicts a final status or
 * disagrees with the stored report at the same timestamp; the database has
 * written a bvnk_exceptions row and the caller raises an alert.
 */
export async function upsertBvnkRecord(row: BvnkRecordRow): Promise<UpsertOutcome> {
  return sbRpc<UpsertOutcome>("bvnk_record_upsert", { p: row });
}

/** BVNK answered 404 for a record we hold: recorded once as an exception. */
export async function markBvnkRecordMissing(row: Pick<BvnkRecordRow, "kind" | "provider_id" | "direction">): Promise<void> {
  await sbRpc("bvnk_record_missing", { p_kind: row.kind, p_provider_id: row.provider_id, p_direction: row.direction });
}

/** States BVNK documents as final; anything else stays open for reconciliation. */
export function isTerminal(kind: BvnkRecordRow["kind"], status: string): boolean {
  if (kind === "payin") return status === "COMPLETED";
  if (kind === "payout") return ["COMPLETED", "EXPIRED", "CANCELLED", "FAILED", "RETURNED"].includes(status);
  if (kind === "transfer") return ["COMPLETED", "FAILED", "EXPIRED"].includes(status);
  return status === "TERMINATED";
}
