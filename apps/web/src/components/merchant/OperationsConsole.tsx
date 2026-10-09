"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { displayUsdc } from "@/lib/payments/merchant/money";
import type { MerchantIntent } from "@/lib/payments/merchant/model";
import type { ReconciliationAlert, ReviewNote } from "@/lib/payments/merchant/operations";
import { ChainMark, request } from "./shared";

// Operator console. Reads held payments and reconciliation alerts; records
// decisions. It has no button that credits a merchant or moves funds — the
// verifier is the only path to a credit, and refunds need the custody provider.
type Snapshot = { held: MerchantIntent[]; alerts: ReconciliationAlert[]; notes: ReviewNote[]; pricing: { merchant_id: string; tier: string; processing_bps: number; set_at: string; note: string }[]; tiers: Record<string, number> };
const DECISIONS = [["note", "Note"], ["confirmed_hold", "Confirm hold"], ["escalated", "Escalate"], ["refund_requested", "Request refund (manual)"]] as const;

export default function OperationsConsole() {
  const [data, setData] = useState<Snapshot | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await request<Snapshot>("/api/merchant/operations")); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function post(body: object, done: string) {
    setNotice("");
    try { await request("/api/merchant/operations", { method: "POST", body: JSON.stringify(body) }); setNotice(done); void load(); }
    catch (e) { setNotice((e as Error).message); }
  }
  return <div className="os mp-workspace">
    <header className="mp-header"><Link className="mp-brand" href="/settlement"><FurlPayMark size={27} /><b>FurlPay</b><span>Operations</span></Link></header>
    <main className="mp-main" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div className="mp-page-heading"><div><span className="mp-eyebrow">MERCHANT PAYMENTS</span><h1>Operations</h1><p>Held payments and reconciliation findings. Decisions are recorded; funds move only through verified chain evidence.</p></div>
        <div className="mp-heading-actions"><button className="mp-button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "mp-spin" : ""} />Refresh</button></div></div>
      {error && <p className="mp-error" role="alert">{error}</p>}{notice && <p className="mp-setup-notice" role="status">{notice}</p>}
      <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Held for review</h2><span>{data?.held.length ?? 0} payments</span></div></div>
        {data?.held.length ? <div className="mp-table-scroll"><table><thead><tr><th>Payment</th><th>Received</th><th>Network</th><th>Notes</th><th>Record decision</th></tr></thead><tbody>
          {data.held.map(i => <tr key={i.id}><td><code>{i.id.slice(0, 13)}</code><small style={{ display: "block" }}>merchant {i.merchant_id.slice(0, 8)}</small></td><td className="mp-money">{displayUsdc(i.received_units)}<small>of {displayUsdc(i.charge_units)}</small></td><td><span className="mp-chain-cell"><ChainMark chain={i.chain} size={18} />{i.chain}</span></td>
            <td>{data.notes.filter(n => n.intent_id === i.id).slice(0, 3).map(n => <small key={n.id} style={{ display: "block" }}>{n.decision}: {n.note}</small>)}</td>
            <td><DecisionForm onSubmit={(decision, note) => post({ action: "note", intentId: i.id, decision, note }, "Decision recorded.")} /></td></tr>)}
        </tbody></table></div> : <div className="mp-empty"><p>{data ? "Nothing is held for review." : loading ? "Loading…" : "Unavailable."}</p></div>}
      </section>
      <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Reconciliation alerts</h2><span>{data?.alerts.length ?? 0} open</span></div></div>
        {data?.alerts.length ? <div className="mp-table-scroll"><table><thead><tr><th>Severity</th><th>Kind</th><th>Payment</th><th>Detail</th><th>Resolve</th></tr></thead><tbody>
          {data.alerts.map(a => <tr key={a.id}><td>{a.severity === "high" ? <><ShieldAlert size={14} /> High</> : "Medium"}</td><td>{a.kind}</td><td><code>{a.intent_id.slice(0, 13)}</code></td><td><small>{a.detail}</small></td>
            <td><NoteForm label="Resolve" onSubmit={note => post({ action: "resolve_alert", alertId: a.id, note }, "Alert resolved.")} /></td></tr>)}
        </tbody></table></div> : <div className="mp-empty"><p>No open alerts.</p></div>}
      </section>
      <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Pricing tiers</h2><span>Admins only · applies to links created afterwards</span></div></div>
        <PricingForm tiers={data?.tiers ?? {}} onSubmit={(merchantId, tier, note) => post({ action: "set_pricing", merchantId, tier, note }, "Tier assigned.")} />
        {data?.pricing.length ? <div className="mp-table-scroll"><table><thead><tr><th>Merchant</th><th>Tier</th><th>Rate</th><th>Set</th><th>Note</th></tr></thead><tbody>
          {data.pricing.map(p => <tr key={p.merchant_id}><td><code>{p.merchant_id}</code></td><td>{p.tier}</td><td>{(p.processing_bps / 100).toFixed(2)}%</td><td>{new Date(p.set_at).toLocaleDateString()}</td><td><small>{p.note}</small></td></tr>)}
        </tbody></table></div> : null}
      </section>
    </main>
  </div>;
}

function NoteForm({ label, onSubmit }: { label: string; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return <form style={{ display: "flex", gap: 6 }} onSubmit={e => { e.preventDefault(); onSubmit(note); setNote(""); }}><input aria-label="Note" required minLength={5} maxLength={500} placeholder="Reason" value={note} onChange={e => setNote(e.target.value)} /><button className="mp-button secondary">{label}</button></form>;
}
function DecisionForm({ onSubmit }: { onSubmit: (decision: string, note: string) => void }) {
  const [decision, setDecision] = useState("note"); const [note, setNote] = useState("");
  return <form style={{ display: "flex", gap: 6 }} onSubmit={e => { e.preventDefault(); onSubmit(decision, note); setNote(""); }}>
    <select aria-label="Decision" value={decision} onChange={e => setDecision(e.target.value)}>{DECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    <input aria-label="Note" required minLength={5} maxLength={2000} placeholder="What you checked" value={note} onChange={e => setNote(e.target.value)} /><button className="mp-button secondary">Record</button></form>;
}
function PricingForm({ tiers, onSubmit }: { tiers: Record<string, number>; onSubmit: (merchantId: string, tier: string, note: string) => void }) {
  const [merchantId, setMerchantId] = useState(""); const [tier, setTier] = useState("growth"); const [note, setNote] = useState("");
  return <form style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 16 }} onSubmit={e => { e.preventDefault(); onSubmit(merchantId, tier, note); }}>
    <input aria-label="Merchant ID" required pattern="[0-9a-fA-F-]{36}" placeholder="Merchant ID" value={merchantId} onChange={e => setMerchantId(e.target.value)} />
    <select aria-label="Tier" value={tier} onChange={e => setTier(e.target.value)}>{Object.entries(tiers).map(([t, bps]) => <option key={t} value={t}>{t} · {(bps / 100).toFixed(2)}%</option>)}</select>
    <input aria-label="Reason" required minLength={5} maxLength={500} placeholder="Reason (contract, volume)" value={note} onChange={e => setNote(e.target.value)} />
    <button className="mp-button primary">Assign tier</button></form>;
}
