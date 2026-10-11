import { z } from "zod";
import type { Transaction } from "@/lib/types";
import { matchesType, TX_TYPES } from "./overview";
import type { Activity, Draft, DraftKind, WorkspaceRecord } from "./model";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const transactionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25), cursor: z.string().max(400).optional(),
  q: z.string().trim().max(120).optional(), type: z.enum(TX_TYPES).default("all"),
  status: z.enum(["any", "settled", "pending", "escrow", "declined"]).default("any"), direction: z.enum(["any", "in", "out"]).default("any"),
  network: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(), asset: z.string().regex(/^[A-Z0-9]{2,12}$/).optional(),
  category: z.string().regex(/^[a-z_]{1,32}$/).optional(), from: day.optional(), to: day.optional(),
  min: z.coerce.number().finite().min(0).max(1_000_000_000).optional(), max: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.from && v.to && v.from > v.to) ctx.addIssue({ code: "custom", path: ["to"], message: "End date must follow start date" });
  if (v.min !== undefined && v.max !== undefined && v.min > v.max) ctx.addIssue({ code: "custom", path: ["max"], message: "Maximum must be at least minimum" });
});
export type TransactionQuery = z.infer<typeof transactionQuery>;
export function filterTransactions(rows: Transaction[], f: TransactionQuery): Transaction[] {
  const q = f.q?.toLowerCase();
  return rows.filter((t) => matchesType(t, f.type) &&
    (f.status === "any" || t.status === f.status) && (f.direction === "any" || t.direction === f.direction) &&
    (!f.network || (t.chain ?? "account") === f.network) && (!f.asset || (t.token ?? "USD") === f.asset) &&
    (!f.category || t.category === f.category) && (!f.from || Date.parse(t.timestamp) >= Date.parse(f.from)) &&
    (!f.to || Date.parse(t.timestamp) < Date.parse(f.to) + 86_400_000) &&
    (f.min === undefined || Math.abs(t.amountUsd) >= f.min) && (f.max === undefined || Math.abs(t.amountUsd) <= f.max) &&
    (!q || [t.id, t.title, t.subtitle, t.token, t.chain].some((v) => v?.toLowerCase().includes(q))));
}
export function toActivity(row: Transaction): Activity {
  return { id: row.id, name: row.title, detail: row.subtitle || undefined, type: row.category, direction: row.direction, amountUsd: row.amountUsd, asset: row.token ?? "USD", network: row.chain ?? "account", status: row.status, timestamp: row.timestamp };
}
export const DRAFT_PATH: Record<DraftKind, string> = { invoice: "/settlement/payments/invoices", link: "/settlement/payments/links", checkout: "/settlement/payments/checkout", payout: "/settlement/payouts/send", schedule: "/settlement/payouts/schedules", beneficiary: "/settlement/payouts/beneficiaries", rule: "/settlement/treasury/rules" };
export function draftSearchText(d: Draft): string {
  return [d.name, d.kind, "note" in d && d.note, "asset" in d && d.asset, "network" in d && d.network, "address" in d && d.address, "amount" in d && d.amount,
    d.kind === "invoice" && [d.customer, d.dueDate, ...d.lines.map((l) => l.description)].join(" "),
    d.kind === "schedule" && [d.startDate, d.frequency].join(" "),
    d.kind === "rule" && d.allocations.map((a) => a.label).join(" ")].filter(Boolean).join(" ").toLowerCase();
}
export type SearchHit = { id: string; name: string; group: "Transactions" | "Drafts" | "Beneficiaries"; detail: string; href: string };
export function draftHit(r: WorkspaceRecord): SearchHit {
  return { id: r.id, name: r.data.name, group: r.data.kind === "beneficiary" ? "Beneficiaries" : "Drafts", detail: `${r.data.kind} · ${r.archivedAt ? "Archived" : "Draft"}`, href: `${DRAFT_PATH[r.data.kind]}?draft=${encodeURIComponent(r.id)}` };
}
