"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INQUIRY_STATUSES, PARTNERSHIP_INTERESTS, type InquiryStatus } from "@/lib/partnerships/model";
import type { Activity, Inquiry } from "@/lib/partnerships/repository";

// Staff view of partnership inquiries. Data comes from /api/admin/partnerships,
// which requires the admin role; this component renders whatever that route
// allows and shows its errors as-is (403, 503 without migration 0049).
const LABEL: Record<InquiryStatus, string> = { new: "New", reviewing: "Reviewing", contacted: "Contacted", qualified: "Qualified", in_discussion: "In discussion", accepted: "Accepted", declined: "Declined", closed: "Closed" };
const interestTitle = (id: string) => PARTNERSHIP_INTERESTS.find(i => i.id === id)?.title ?? id;
const when = (iso: string) => new Date(iso).toLocaleString();

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export default function InquiryConsole() {
  const [status, setStatus] = useState<InquiryStatus | "">("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{ inquiry: Inquiry; activity: Activity[] } | null>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState<InquiryStatus>("reviewing");
  const [busy, setBusy] = useState(false);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++listVersion.current;
    setError("");
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    try { const result = await call<{ inquiries: Inquiry[] }>(`/api/admin/partnerships?${params}`); if (version === listVersion.current) setRows(result.inquiries); }
    catch (e) { if (version === listVersion.current) { setRows([]); setError((e as Error).message); } }
  }, [status, q]);
  useEffect(() => {
    const version = listVersion;
    const t = setTimeout(() => void load(), 250);
    return () => { clearTimeout(t); version.current++; };
  }, [load]);

  async function open(id: string) {
    const version = ++detailVersion.current;
    setError(""); setNote(""); setDetail(null);
    try { const d = await call<{ inquiry: Inquiry; activity: Activity[] }>(`/api/admin/partnerships?id=${id}`); if (version === detailVersion.current) { setDetail(d); setNext(d.inquiry.status === "new" ? "reviewing" : d.inquiry.status); } }
    catch (e) { if (version === detailVersion.current) setError((e as Error).message); }
  }
  async function act(body: object) {
    if (!detail || busy) return;
    setBusy(true); setError("");
    try { setDetail(await call(`/api/admin/partnerships`, { method: "PATCH", body: JSON.stringify(body) })); setNote(""); void load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 text-white">
      <h1 className="text-[28px] font-bold tracking-tight">Partnership inquiries</h1>
      <p className="mt-1 text-[14px] text-white/60">Submitted through /partners. Contact details are visible to admins only; every status change and note records who made it.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <label className="text-[13px] text-white/70">Status{" "}
          <select value={status} onChange={e => setStatus(e.target.value as InquiryStatus | "")} className="ml-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white">
            <option value="">All</option>
            {INQUIRY_STATUSES.map(s => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex-1 text-[13px] text-white/70">Search{" "}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Company or email" className="ml-1 w-full max-w-sm rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
        </label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-200">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead className="bg-white/[0.03] text-white/60"><tr><th className="px-4 py-3">Received</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Interest</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Team notified</th><th className="px-4 py-3"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows === null ? <tr><td className="px-4 py-6 text-white/50" colSpan={6}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td className="px-4 py-6 text-white/50" colSpan={6}>{error ? "—" : "No inquiries match."}</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-3 text-white/70">{when(r.created_at)}</td>
                  <td className="px-4 py-3 font-medium">{r.company_name}</td>
                  <td className="px-4 py-3 text-white/80">{interestTitle(r.partnership_interest)}</td>
                  <td className="px-4 py-3">{LABEL[r.status]}</td>
                  <td className="px-4 py-3 text-white/70">{r.notification_state === "sent" ? "Emailed" : r.notification_state === "not_configured" ? "Not configured" : r.notification_state === "failed" ? "Failed" : "Pending"}</td>
                  <td className="px-4 py-3 text-right"><button type="button" disabled={busy} onClick={() => void open(r.id)} aria-label={`Open inquiry from ${r.company_name}`} className="rounded-lg border border-white/15 px-3 py-1.5 hover:border-emerald-400/60 disabled:opacity-50">Open</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-6" aria-labelledby="inq-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="inq-title" className="text-[20px] font-semibold">{detail.inquiry.company_name}</h2>
            <button type="button" disabled={busy} onClick={() => { detailVersion.current++; setDetail(null); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-[13px]">Close</button>
          </div>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-[14px] sm:grid-cols-2">
            {([["Work email", detail.inquiry.work_email], ["Contact", `${detail.inquiry.contact_method}: ${detail.inquiry.contact_detail}`], ["Name", detail.inquiry.full_name], ["Job title", detail.inquiry.job_title],
              ["Website", detail.inquiry.website], ["Interest", interestTitle(detail.inquiry.partnership_interest)], ["Source", detail.inquiry.source_page], ["Received", when(detail.inquiry.created_at)]] as [string, string | null][])
              .map(([k, v]) => <div key={k}><dt className="text-white/50">{k}</dt><dd className="break-words">{v || "—"}</dd></div>)}
          </dl>
          {detail.inquiry.additional_information && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-[14px] text-white/85">{detail.inquiry.additional_information}</p>}

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-[13px] text-white/70">Note (optional for a status change)
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white" />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[13px] text-white/70">Move to
                <select value={next} onChange={e => setNext(e.target.value as InquiryStatus)} className="ml-1 mt-1 block rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-white">
                  {INQUIRY_STATUSES.map(s => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy || next === detail.inquiry.status} onClick={() => void act({ action: "status", id: detail.inquiry.id, from: detail.inquiry.status, to: next, note: note.trim() || undefined })} className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-black disabled:opacity-50">Update status</button>
              <button type="button" disabled={busy || !note.trim()} onClick={() => void act({ action: "note", id: detail.inquiry.id, note: note.trim() })} className="rounded-lg border border-white/15 px-4 py-2 disabled:opacity-50">Add note</button>
            </div>
          </div>

          <h3 className="mt-8 text-[15px] font-semibold">Activity</h3>
          <ol className="mt-2 space-y-2 text-[14px]">
            {detail.activity.length === 0 ? <li className="text-white/50">No activity yet.</li> : detail.activity.map(a => (
              <li key={a.id} className="rounded-lg border border-white/5 px-3 py-2">
                <span className="text-white/50">{when(a.created_at)} · {a.actor}</span>
                <div>{a.kind === "status" ? <>Status {LABEL[a.from_status as InquiryStatus] ?? a.from_status} → {LABEL[a.to_status as InquiryStatus] ?? a.to_status}{a.note ? `: ${a.note}` : ""}</> : a.note}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
