import { sbInsert, sbRpc, sbSelect, sbUpdate, supabaseBackend } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { PARTNERSHIP_INTERESTS, type InquiryStatus, type NormalizedInquiry } from "./model";

export class InquiriesUnavailable extends Error {}
export function requireInquiryStorage() {
  if (supabaseBackend !== "supabase") throw new InquiriesUnavailable("Partnership inquiry storage is not configured");
}

export type Inquiry = NormalizedInquiry & { id: string; status: InquiryStatus; notification_state: string; notified_at: string | null; created_at: string; updated_at: string };
export type Activity = { id: number; inquiry_id: string; kind: "note" | "status"; from_status: string | null; to_status: string | null; note: string | null; actor: string; created_at: string };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const interestTitle = (id: string) => PARTNERSHIP_INTERESTS.find(i => i.id === id)?.title ?? id;

/**
 * Persist first; notify second. The submitter is told "received" only because
 * the row committed — the internal email is best-effort and its outcome is
 * recorded on the row (not_configured / sent / failed), never assumed.
 */
export async function submitInquiry(row: NormalizedInquiry): Promise<{ id: string; duplicate: boolean; notification: string }> {
  requireInquiryStorage();
  const [res] = await sbRpc<{ id: string; duplicate: boolean }[]>("partnership_inquiry_submit", { p: row });
  if (!res?.id) throw new Error("Inquiry was not stored");
  if (res.duplicate) return { id: res.id, duplicate: true, notification: "unchanged" };

  const to = (process.env.PARTNERSHIPS_NOTIFY_EMAIL ?? "").trim();
  let state: "sent" | "not_configured" | "failed" = "not_configured";
  if (to && process.env.RESEND_API_KEY) {
    try {
      const subject = `Partnership inquiry: ${row.company_name} · ${interestTitle(row.partnership_interest)}`;
      const lines = [
        ["Company / project", row.company_name], ["Work email", row.work_email], ["Contact", `${row.contact_method}: ${row.contact_detail}`],
        ["Name", row.full_name ?? "—"], ["Job title", row.job_title ?? "—"], ["Website", row.website ?? "—"],
        ["Interest", interestTitle(row.partnership_interest)], ["Message", row.additional_information ?? "—"],
      ];
      const sent = await sendEmail({
        to, subject, category: "ops", replyTo: row.work_email, idempotencyKey: `partnership-inquiry:${res.id}`,
        text: lines.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nInquiry ${res.id}`,
        html: `<table>${lines.map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table><p>Inquiry ${esc(res.id)}</p>`,
      });
      state = sent.ok && !("mocked" in sent && sent.mocked) ? "sent" : "failed";
    } catch {
      state = "failed";
    }
  }
  try {
    await sbUpdate("partnership_inquiries", `id=eq.${res.id}`, { notification_state: state, notified_at: state === "sent" ? new Date().toISOString() : null });
  } catch {
    log.warn("partnership inquiry notification state not recorded", { id: res.id });
  }
  return { id: res.id, duplicate: false, notification: state };
}

/** Staff list: optional status filter and a search over company and email. */
export async function listInquiries(opts: { status?: InquiryStatus; q?: string; limit?: number }) {
  requireInquiryStorage();
  const parts = [`order=created_at.desc`, `limit=${Math.min(Math.max(opts.limit ?? 100, 1), 200)}`];
  if (opts.status) parts.push(`status=eq.${opts.status}`);
  // PostgREST filter syntax: strip everything that could change the expression, keep the search words.
  const q = (opts.q ?? "").replace(/[^\p{L}\p{N}@._ -]/gu, "").trim().slice(0, 80);
  if (q) parts.push(`or=(company_name.ilike.*${encodeURIComponent(q)}*,work_email.ilike.*${encodeURIComponent(q)}*)`);
  return sbSelect<Inquiry>("partnership_inquiries", parts.join("&"));
}

export async function inquiryDetail(id: string) {
  requireInquiryStorage();
  const [inquiry] = await sbSelect<Inquiry>("partnership_inquiries", `id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!inquiry) return null;
  const activity = await sbSelect<Activity>("partnership_inquiry_activity", `inquiry_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=200`);
  return { inquiry, activity };
}

export async function setInquiryStatus(id: string, from: InquiryStatus, to: InquiryStatus, actor: string, note?: string) {
  requireInquiryStorage();
  return sbRpc<boolean>("partnership_inquiry_set_status", { p_id: id, p_from: from, p_to: to, p_actor: actor, p_note: note ?? "" });
}

export async function addInquiryNote(id: string, actor: string, note: string) {
  requireInquiryStorage();
  const [row] = await sbInsert<Partial<Activity>>("partnership_inquiry_activity", { inquiry_id: id, kind: "note", note, actor });
  return row;
}
