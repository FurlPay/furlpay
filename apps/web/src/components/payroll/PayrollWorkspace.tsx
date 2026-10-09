"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Plus, RefreshCw, Send, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { ChainMark, Dialog, request } from "@/components/merchant/shared";
import SigningPanel from "./SigningPanel";
import { displayUsdc, parseUsdc } from "@/lib/payments/merchant/money";
import { quoteBatch } from "@/lib/payroll/pricing";
import type { Batch, BatchLine, Contractor, PayrollChain } from "@/lib/payroll/model";

// Payroll workspace: saved roster → draft batch (fee quote + screening) →
// submit, which returns one payment intent per line for the employer's own
// wallet to sign. Nothing here moves money or marks anyone paid.
// A batch settles through the FurlPayRouter on its chain; contractors receive on that chain.
const CHAINS: { id: PayrollChain; name: string }[] = [{ id: "arbitrum", name: "Arbitrum" }, { id: "base", name: "Base" }, { id: "arc", name: "Arc" }, { id: "polygon", name: "Polygon" }];
const STATUS: Record<Batch["status"], string> = { draft: "Draft", blocked: "Blocked by screening", submitting: "Submitting", submitted: "Awaiting signatures", completed: "Paid on-chain", cancelled: "Cancelled" };
type Detail = { batch: Batch; lines: BatchLine[]; executionAvailable?: boolean; router?: string | null; token?: string; chainId?: number };
const thisCycle = () => new Date().toISOString().slice(0, 7);

export default function PayrollWorkspace() {
  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false); const [drafting, setDrafting] = useState(false); const [taxFor, setTaxFor] = useState<Contractor | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [c, b] = await Promise.all([request<{ contractors: Contractor[] }>("/api/payouts/payroll/contractors"), request<{ batches: Batch[] }>("/api/payouts/payroll/batches")]);
      setContractors(c.contractors); setBatches(b.batches);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const active = (contractors ?? []).filter(c => c.active);
  const monthly = active.reduce((s, c) => s + BigInt(String(c.default_amount_units)), 0n);

  async function act(id: string, action: "submit" | "cancel" | "reissue") {
    setNotice("");
    try {
      await request("/api/payouts/payroll/batches", { method: "PATCH", body: JSON.stringify({ id, action }) });
      // Signing requests live in the database: re-open the batch to resume from there.
      if (action === "cancel") setDetail(null); else await open(id);
      void load();
    } catch (e) { setNotice((e as Error).message); }
  }
  async function open(id: string) {
    setNotice("");
    try { setDetail(await request(`/api/payouts/payroll/batches?id=${id}`)); } catch (e) { setNotice((e as Error).message); }
  }
  async function toggle(c: Contractor) {
    setNotice("");
    try { await request("/api/payouts/payroll/contractors", { method: "PATCH", body: JSON.stringify({ id: c.id, active: !c.active }) }); void load(); }
    catch (e) { setNotice((e as Error).message); }
  }

  return <div className="os mp-workspace">
    <header className="mp-header"><Link className="mp-brand" href="/settlement"><FurlPayMark size={27} /><b>FurlPay</b><span>Business</span></Link><nav aria-label="Workspaces"><Link href="/settlement">Overview</Link><Link href="/dashboard/payments">Payments</Link><Link href="/dashboard/payroll" aria-current="page">Payroll</Link><Link href="/settlement/treasury">Treasury</Link></nav></header>
    <main className="mp-main" style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div className="mp-page-heading"><div><span className="mp-eyebrow">GLOBAL PAYROLL</span><h1>Payroll</h1><p>Pay your team in USDC from your own wallet. Every recipient is screened before a batch can be submitted.</p></div>
        <div className="mp-heading-actions"><button className="mp-button secondary" disabled={!contractors} onClick={() => setAdding(true)}><Plus size={16} />Add contractor</button><button className="mp-button primary" disabled={!active.length} onClick={() => setDrafting(true)}><Users size={16} />New payroll batch</button></div></div>
      {error && <div className="mp-error" role="alert"><p>{error}</p><button className="mp-button secondary" onClick={() => void load()}>Try again</button></div>}
      {notice && <p className="mp-error" role="alert">{notice}</p>}
      <div className="mp-metrics">
        <Metric label="Active contractors" value={contractors ? String(active.length) : "—"} hint="Seats billed per month" count />
        <Metric label="Monthly run rate" value={contractors ? displayUsdc(monthly) : "—"} hint="Sum of default amounts" />
        <Metric label="Seat fee quote" value={contractors ? displayUsdc(BigInt(active.length) * 19_000_000n) : "—"} hint="19 USDC per active contractor, once a month" />
        <Metric label="Open batches" value={batches ? String(batches.filter(b => b.status === "draft" || b.status === "submitted").length) : "—"} hint="Drafts and batches awaiting signatures" count />
      </div>
      <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Contractors</h2><span>{contractors?.length ?? 0} on roster</span></div><button aria-label="Refresh" className="mp-icon-button" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? "mp-spin" : ""} /></button></div>
        {!contractors ? <div className="mp-empty" role="status">{loading ? "Loading roster…" : "Roster unavailable."}</div> : contractors.length ? <div className="mp-table-scroll"><table><thead><tr><th>Name</th><th>Country</th><th>Network</th><th>Payout address</th><th>Default</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {contractors.map(c => <tr key={c.id}><td><strong>{c.name}</strong><small style={{ display: "block" }}>{c.role || c.email}</small></td><td>{c.country}</td><td><span className="mp-chain-cell"><ChainMark chain={c.payout_chain} size={18} />{c.payout_chain}</span></td><td><code>{c.payout_address.slice(0, 8)}…{c.payout_address.slice(-6)}</code></td><td className="mp-money">{displayUsdc(BigInt(String(c.default_amount_units)))}<small>USDC</small></td><td>{c.active ? "Active" : "Inactive"}<small style={{ display: "block" }}>{taxLabel(c)}</small></td><td><button className="mp-button secondary" onClick={() => setTaxFor(c)}>Tax form</button> <button className="mp-button secondary" onClick={() => void toggle(c)}>{c.active ? "Deactivate" : "Reactivate"}</button></td></tr>)}
        </tbody></table></div> : <div className="mp-empty"><h3>No contractors yet</h3><p>Add the people you pay. Their payout address is saved here and every batch pays only these addresses.</p></div>}
      </section>
      <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Batches</h2><span>{batches?.length ?? 0} recent</span></div></div>
        {batches?.length ? <div className="mp-table-scroll"><table><thead><tr><th>Cycle</th><th>Network</th><th>Headcount</th><th>Gross</th><th>Fee quote</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>
          {batches.map(b => <tr key={b.id}><td>{b.cycle}</td><td><span className="mp-chain-cell"><ChainMark chain={b.chain} size={18} />{b.chain}</span></td><td>{b.headcount}</td><td className="mp-money">{displayUsdc(BigInt(String(b.gross_units)))}<small>USDC</small></td><td className="mp-money">{displayUsdc(BigInt(String(b.batch_fee_units)) + BigInt(String(b.seat_fee_units)))}<small>USDC</small></td><td>{STATUS[b.status]}</td><td><button className="mp-button secondary" onClick={() => void open(b.id)}>Open</button></td></tr>)}
        </tbody></table></div> : <div className="mp-empty"><p>No payroll batches yet.</p></div>}
        <footer className="mp-table-footer"><span>Fees are quotes recorded with each batch; billing is not connected yet.</span><span><ShieldCheck size={13} />Non-custodial: you sign every payment</span></footer>
      </section>
    </main>
    {taxFor && <Dialog title={`Tax form for ${taxFor.name}`} onClose={() => setTaxFor(null)}><TaxForm contractor={taxFor} onSaved={() => { setTaxFor(null); void load(); }} /></Dialog>}
    {adding && <Dialog title="Add a contractor" onClose={() => setAdding(false)}><ContractorForm onSaved={() => { setAdding(false); void load(); }} /></Dialog>}
    {drafting && <Dialog title="New payroll batch" onClose={() => setDrafting(false)}><BatchForm roster={active} chargedCycles={new Set((batches ?? []).filter(b => BigInt(String(b.seat_fee_units)) > 0n).map(b => b.cycle))} onSaved={d => { setDrafting(false); setDetail(d); void load(); }} /></Dialog>}
    {detail && <Dialog title={`Payroll ${detail.batch.cycle}`} onClose={() => setDetail(null)}><BatchDetail detail={detail} onAction={a => void act(detail.batch.id, a)} onChanged={() => void open(detail.batch.id)} /></Dialog>}
  </div>;
}

function Metric({ label, value, hint, count = false }: { label: string; value: string; hint: string; count?: boolean }) {
  return <div className="mp-metric"><span>{label}</span><strong>{value}{!count && <small>USDC</small>}</strong><p>{hint}</p></div>;
}

function ContractorForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ name: "", email: "", role: "", country: "", payoutChain: "base" as PayrollChain, payoutAddress: "", defaultAmount: "" });
  const [requestId] = useState(() => crypto.randomUUID()); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await request("/api/payouts/payroll/contractors", { method: "POST", body: JSON.stringify({ requestId, ...f, country: f.country.toUpperCase(), role: f.role || undefined }) }); onSaved(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="mp-detail" onSubmit={save}>
    <label>Full name<input required maxLength={120} value={f.name} onChange={set("name")} /></label>
    <label>Email<input required type="email" maxLength={200} value={f.email} onChange={set("email")} /></label>
    <label>Role (optional)<input maxLength={80} value={f.role} onChange={set("role")} /></label>
    <label>Country (ISO code, e.g. DE)<input required maxLength={2} pattern="[A-Za-z]{2}" value={f.country} onChange={set("country")} /></label>
    <label>Network<select value={f.payoutChain} onChange={set("payoutChain")}>{CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Payout wallet address<input required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value={f.payoutAddress} onChange={set("payoutAddress")} /></label>
    <label>Default monthly amount (USDC)<input required inputMode="decimal" value={f.defaultAmount} onChange={set("defaultAmount")} /></label>
    <p><ShieldAlert size={14} /> Double-check the address with the contractor. USDC sent to a wrong address cannot be recovered.</p>
    {error && <p className="mp-error" role="alert">{error}</p>}
    <button className="mp-button primary" disabled={busy}>{busy ? "Saving…" : "Save contractor"}</button>
  </form>;
}

function BatchForm({ roster, chargedCycles, onSaved }: { roster: Contractor[]; chargedCycles: Set<string>; onSaved: (d: { batch: Batch; lines: BatchLine[] }) => void }) {
  const [chain, setChain] = useState<PayrollChain>(roster[0]?.payout_chain ?? "base"); const [cycle, setCycle] = useState(thisCycle());
  const eligible = roster.filter(c => c.payout_chain === chain);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [requestId] = useState(() => crypto.randomUUID()); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lines = eligible.filter(c => c.id in picked);
  const quote = useMemo(() => {
    try { return lines.length ? quoteBatch(lines.map(c => picked[c.id] ? parseUsdc(picked[c.id]) : BigInt(String(c.default_amount_units))), roster.length, chargedCycles.has(cycle)) : null; }
    catch { return null; }
  }, [lines, picked, roster.length, chargedCycles, cycle]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      onSaved(await request("/api/payouts/payroll/batches", { method: "POST", body: JSON.stringify({ requestId, cycle, chain, lines: lines.map(c => ({ contractorId: c.id, ...(picked[c.id] ? { amount: picked[c.id] } : {}) })) }) }));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="mp-detail" onSubmit={save}>
    <label>Pay cycle<input type="month" required value={cycle} onChange={e => setCycle(e.target.value)} /></label>
    <label>Network<select value={chain} onChange={e => { setChain(e.target.value as PayrollChain); setPicked({}); }}>{CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {eligible.length ? <fieldset><legend>Contractors paid on {chain}</legend>{eligible.map(c => <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label><input type="checkbox" checked={c.id in picked} onChange={e => { const n = { ...picked }; if (e.target.checked) n[c.id] = ""; else delete n[c.id]; setPicked(n); }} /> {c.name}</label>
      {c.id in picked && <input aria-label={`Amount for ${c.name}`} inputMode="decimal" placeholder={displayUsdc(BigInt(String(c.default_amount_units)))} value={picked[c.id]} onChange={e => setPicked({ ...picked, [c.id]: e.target.value })} />}
    </div>)}</fieldset> : <p>No active contractors are paid on this network.</p>}
    {quote && <dl><div><dt>Gross</dt><dd>{displayUsdc(quote.gross)} USDC</dd></div><div><dt>Batch fee (0.35%, min 1.50)</dt><dd>{displayUsdc(quote.batchFee)} USDC</dd></div><div><dt>Seat fee ({chargedCycles.has(cycle) ? "already quoted this month" : `${roster.length} × 19`})</dt><dd>{displayUsdc(quote.seatFee)} USDC</dd></div><div><dt>Total quote</dt><dd><strong>{displayUsdc(quote.total)} USDC</strong></dd></div></dl>}
    <p>The final quote is computed by the server when the draft is saved.</p>
    {error && <p className="mp-error" role="alert">{error}</p>}
    <button className="mp-button primary" disabled={busy || !lines.length}>{busy ? "Screening recipients…" : "Create draft"}</button>
  </form>;
}

function BatchDetail({ detail, onAction, onChanged }: { detail: Detail; onAction: (a: "submit" | "cancel" | "reissue") => void; onChanged: () => void }) {
  const b = detail.batch;
  return <div className="mp-detail">
    <dl><div><dt>Status</dt><dd>{STATUS[b.status]}</dd></div><div><dt>Gross</dt><dd>{displayUsdc(BigInt(String(b.gross_units)))} USDC</dd></div><div><dt>Batch fee quote</dt><dd>{displayUsdc(BigInt(String(b.batch_fee_units)))} USDC</dd></div><div><dt>Seat fee quote</dt><dd>{displayUsdc(BigInt(String(b.seat_fee_units)))} USDC</dd></div><div><dt>Total quote</dt><dd>{displayUsdc(BigInt(String(b.total_quote_units)))} USDC</dd></div></dl>
    <ul>{detail.lines.map(l => <li key={l.id}><strong>{l.name}</strong> · {displayUsdc(BigInt(String(l.amount_units)))} USDC · <code>{l.recipient.slice(0, 8)}…</code> · {l.screening === "clear" ? "Screening clear" : l.screening === "blocked" ? "Flagged by screening" : "Screening unavailable"}{l.payment_id && <> · <code>{l.payment_id}</code></>}</li>)}</ul>
    {b.status === "blocked" && <p className="mp-error" role="alert">At least one recipient did not clear screening, so this batch cannot be submitted. Cancel it and create a new batch without that recipient, or contact support.</p>}
    <div className="mp-heading-actions">
      {(b.status === "draft" || b.status === "blocked") && <button className="mp-button secondary" onClick={() => onAction("cancel")}><Ban size={15} />Cancel batch</button>}
      {b.status === "draft" && <button className="mp-button primary" onClick={() => onAction("submit")}><Send size={15} />Submit for signing</button>}
    </div>
    {(b.status === "submitted" || b.status === "completed") && <SigningPanel detail={detail} onChanged={onChanged} onReissue={() => onAction("reissue")} />}
  </div>;
}

function taxLabel(c: Contractor) {
  if (!c.tax_form) return "No tax form on file";
  const expired = c.tax_expires_on && c.tax_expires_on < new Date().toISOString().slice(0, 10);
  return `${c.tax_form === "w9" ? "W-9" : "W-8BEN"} on file · TIN …${c.tin_last4 ?? "none"}${c.tax_expires_on ? ` · ${expired ? "expired" : "valid through"} ${c.tax_expires_on}` : ""}`;
}

// Records a payee-signed form the employer already holds. The TIN is sealed server-side and never shown again.
function TaxForm({ contractor, onSaved }: { contractor: Contractor; onSaved: () => void }) {
  const us = contractor.country === "US";
  const [f, setF] = useState({ legalName: contractor.name, tinType: us ? "ssn" : "foreign", tin: "", taxResidence: contractor.country, line1: "", city: "", region: "", postalCode: "", signedOn: "", attestation: false });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const address = { line1: f.line1, city: f.city, country: contractor.country, ...(f.region ? { region: f.region } : {}), ...(f.postalCode ? { postalCode: f.postalCode } : {}) };
    const body = us ? { form: "w9", tinType: f.tinType, tin: f.tin, legalName: f.legalName, address, signedOn: f.signedOn, attestation: f.attestation }
      : { form: "w8ben", tinType: f.tinType, ...(f.tinType === "none" ? {} : { tin: f.tin }), taxResidence: f.taxResidence.toUpperCase(), legalName: f.legalName, address, signedOn: f.signedOn, attestation: f.attestation };
    try { await request(`/api/payouts/payroll/contractors/${contractor.id}/tax`, { method: "POST", body: JSON.stringify(body) }); onSaved(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="mp-detail" onSubmit={save}>
    <p>{us ? "Form W-9 (US person)." : "Form W-8BEN (foreign individual). Valid through the last day of the third calendar year after signing."} Enter the details exactly as they appear on the form the contractor signed.</p>
    <label>Legal name<input required maxLength={160} value={f.legalName} onChange={set("legalName")} /></label>
    <label>TIN type<select value={f.tinType} onChange={set("tinType")}>{(us ? [["ssn", "SSN"], ["ein", "EIN"], ["itin", "ITIN"]] : [["foreign", "Foreign TIN"], ["itin", "US ITIN"], ["none", "None on form"]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {f.tinType !== "none" && <label>TIN<input required autoComplete="off" value={f.tin} onChange={set("tin")} /></label>}
    {!us && <label>Country of tax residence<input required maxLength={2} value={f.taxResidence} onChange={set("taxResidence")} /></label>}
    <label>Address<input required maxLength={120} value={f.line1} onChange={set("line1")} /></label>
    <label>City<input required maxLength={80} value={f.city} onChange={set("city")} /></label>
    <label>State / region<input maxLength={80} value={f.region} onChange={set("region")} /></label>
    <label>Postal code<input maxLength={20} value={f.postalCode} onChange={set("postalCode")} /></label>
    <label>Date signed on the form<input type="date" required value={f.signedOn} onChange={set("signedOn")} /></label>
    <label><input type="checkbox" checked={f.attestation} onChange={e => setF({ ...f, attestation: e.target.checked })} /> I hold this form, signed by the contractor, and will keep it for IRS inspection.</label>
    {error && <p className="mp-error" role="alert">{error}</p>}
    <button className="mp-button primary" disabled={busy || !f.attestation}>{busy ? "Saving…" : "Record tax form"}</button>
  </form>;
}
