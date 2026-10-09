import { z } from "zod";
import { sbInsert, sbSelect, sbUpdate, sbUpsert } from "@/lib/supabase";
import { PRICING, type PricingTier } from "./money";
import { requireStorage } from "./repository";
import type { MerchantIntent } from "./model";

// Operator console for merchant payments (migration 0042). Deliberately narrow:
// operators can READ held payments and reconciliation alerts, RECORD decisions,
// RESOLVE alerts and ASSIGN pricing tiers. There is no action that credits a
// merchant, changes an intent's status or moves a balance: a held payment is
// credited only by the verifier, and refunds need the custody provider that
// controls the collection addresses (not integrated).
export const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("note"), intentId: z.string().uuid(), decision: z.enum(["note", "confirmed_hold", "escalated", "refund_requested"]), note: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ action: z.literal("resolve_alert"), alertId: z.number().int().positive(), note: z.string().trim().min(5).max(500) }).strict(),
  z.object({ action: z.literal("set_pricing"), merchantId: z.string().uuid(), tier: z.enum(Object.keys(PRICING) as [PricingTier, ...PricingTier[]]), note: z.string().trim().min(5).max(500) }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export type ReviewNote = { id: number; intent_id: string; author: string; decision: string; note: string; created_at: string };
export type ReconciliationAlert = { id: number; intent_id: string; kind: string; detail: string; severity: "high" | "medium"; resolved_at: string | null; resolved_by: string | null; resolution: string | null; created_at: string };

export async function operationsSnapshot() {
  requireStorage();
  const [held, alerts, pricing] = await Promise.all([
    sbSelect<MerchantIntent>("merchant_payment_intents", "status=eq.review&order=created_at.desc&limit=100"),
    sbSelect<ReconciliationAlert>("merchant_reconciliation_alerts", "resolved_at=is.null&order=created_at.desc&limit=200"),
    sbSelect<{ merchant_id: string; tier: PricingTier; processing_bps: number; set_by: string; set_at: string; note: string }>("merchant_pricing", "order=set_at.desc&limit=500"),
  ]);
  const ids = [...new Set([...held.map(i => i.id), ...alerts.map(a => a.intent_id)])];
  const notes = ids.length ? await sbSelect<ReviewNote>("merchant_review_notes", `intent_id=in.(${ids.join(",")})&order=created_at.desc&limit=500`) : [];
  return { held, alerts, pricing, notes, tiers: PRICING };
}

export async function applyOperation(actor: string, op: Operation) {
  requireStorage();
  switch (op.action) {
    case "note": {
      const intent = (await sbSelect<MerchantIntent>("merchant_payment_intents", `select=id&id=eq.${op.intentId}&limit=1`))[0];
      if (!intent) return null;
      return (await sbInsert<Omit<ReviewNote, "id" | "created_at">>("merchant_review_notes", { intent_id: op.intentId, author: actor, decision: op.decision, note: op.note }))[0];
    }
    case "resolve_alert":
      return (await sbUpdate<ReconciliationAlert>("merchant_reconciliation_alerts", `id=eq.${op.alertId}&resolved_at=is.null`, { resolved_at: new Date().toISOString(), resolved_by: actor, resolution: op.note }))[0] ?? null;
    case "set_pricing":
      return (await sbUpsert("merchant_pricing", { merchant_id: op.merchantId, tier: op.tier, processing_bps: PRICING[op.tier], set_by: actor, set_at: new Date().toISOString(), note: op.note }))[0];
  }
}
