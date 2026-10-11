"use client";
import { useCallback, useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { displayUsdc } from "@/lib/payments/merchant/money";
import type { MerchantIntent } from "@/lib/payments/merchant/model";
import type { Refund } from "@/lib/payments/merchant/refunds";
import { request } from "./shared";

// Refunds for one payment. Requesting reserves the amount immediately; FurlPay
// operations approve it and the custody provider sends it; it shows as refunded
// only after the transfer is read on-chain.
const LABEL: Record<Refund["status"], string> = { requested: "Requested — awaiting FurlPay approval", pending_external_execution: "Approved — being sent", completed: "Refunded (verified on-chain)", cancelled: "Cancelled" };

export default function RefundPanel({ intent }: { intent: MerchantIntent }) {
  const [refunds, setRefunds] = useState<Refund[]>([]); const [amount, setAmount] = useState(""); const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const refundable = ["underpaid", "paid", "overpaid"].includes(intent.status);
  const load = useCallback(async () => { try { setRefunds((await request<{ refunds: Refund[] }>(`/api/merchant/refunds?intentId=${intent.id}`)).refunds); } catch { /* the form still reports its own errors */ } }, [intent.id]);
  useEffect(() => { void load(); }, [load]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await request("/api/merchant/refunds", { method: "POST", body: JSON.stringify({ requestId, intentId: intent.id, amount, reason }) }); setAmount(""); setReason(""); setRequestId(crypto.randomUUID()); await load(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setError("");
    try { await request(`/api/merchant/refunds?id=${id}`, { method: "DELETE" }); await load(); } catch (err) { setError((err as Error).message); }
  }
  if (!refundable && !refunds.length) return null;
  return <section aria-label="Refunds">
    <h3>Refunds</h3>
    {refunds.length > 0 && <ul>{refunds.map(r => <li key={r.id}>{displayUsdc(String(r.amount_units))} USDC to <code>{r.to_address.slice(0, 10)}…</code> · {LABEL[r.status]}{r.tx_hash && <> · <code>{r.tx_hash.slice(0, 12)}…</code></>}
      {r.status === "requested" && <button className="mp-text-link" onClick={() => void cancel(r.id)}>Cancel</button>}</li>)}</ul>}
    {refundable && <form onSubmit={submit} className="mp-heading-actions">
      <input aria-label="Refund amount (USDC)" required inputMode="decimal" placeholder="Amount (USDC)" value={amount} onChange={e => setAmount(e.target.value)} />
      <input aria-label="Reason" required minLength={3} maxLength={500} placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
      <button className="mp-button secondary" disabled={busy}><Undo2 size={15} />{busy ? "Reserving…" : "Request refund"}</button>
    </form>}
    {error && <p className="mp-error" role="alert">{error}</p>}
    <p className="mp-muted">Refunds go back to the paying wallet. The processing fee is not returned. The amount is set aside now and sent after FurlPay approves it.</p>
  </section>;
}
