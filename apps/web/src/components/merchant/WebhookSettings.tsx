"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { CopyButton, request } from "./shared";

// Merchant webhook settings (API: /api/merchant/webhook). The signing secret is
// shown exactly once, when an endpoint is set or rotated; FurlPay stores it sealed.
type Endpoint = { url: string; secretLast4: string; updatedAt: string | null } | null;
type DeliveryRow = { id: string; type: string; created_at: string; attempts: number; state: "delivered" | "failed" | "retrying" | "pending"; last_error: string | null };
const VERIFY = `// Node: verify X-FurlPay-Signature before trusting the body
const [t, v1] = header.split(",").map(p => p.split("=")[1]);
const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(t)) <= 300;
const ok = fresh && crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
// Dedupe on X-FurlPay-Event-Id: the same event can arrive more than once.`;

export default function WebhookSettings() {
  const [endpoint, setEndpointState] = useState<Endpoint>(null); const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loaded, setLoaded] = useState(false); const [url, setUrl] = useState(""); const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { const d = await request<{ endpoint: Endpoint; deliveries: DeliveryRow[] }>("/api/merchant/webhook"); setEndpointState(d.endpoint); setDeliveries(d.deliveries); setLoaded(true); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const save = () => act(async () => { const r = await request<{ secret: string }>("/api/merchant/webhook", { method: "PUT", body: JSON.stringify({ url }) }); setSecret(r.secret); setUrl(""); await load(); });
  const test = () => act(async () => {
    const res = await fetch("/api/merchant/webhook", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) });
    const d = await res.json();
    if (d.delivered) setNotice(`Test event ${d.id} delivered: your endpoint answered 2xx.`); else throw new Error(d.error ?? `Test event not delivered (${d.reason ?? res.status}).`);
  });
  const remove = () => act(async () => { await request("/api/merchant/webhook", { method: "DELETE" }); setSecret(""); await load(); });
  const resend = (id: string) => act(async () => { await request("/api/merchant/webhook", { method: "POST", body: JSON.stringify({ redeliver: id }) }); setNotice("Queued for redelivery."); await load(); });

  return <div className="os mp-workspace"><main className="mp-main" style={{ maxWidth: 960, margin: "0 auto" }}>
    <Link className="mp-text-link" href="/dashboard/payments"><ArrowLeft size={15} />Payments</Link>
    <div className="mp-page-heading"><div><span className="mp-eyebrow"><FurlPayMark size={12} /> DEVELOPERS</span><h1>Webhooks</h1><p>FurlPay POSTs <code>payment.succeeded</code> and <code>invoice.paid</code> to your HTTPS endpoint, signed with your secret. The ledger, not the webhook, is the source of truth.</p></div></div>
    {error && <p className="mp-error" role="alert">{error}</p>}{notice && <p className="mp-setup-notice" role="status">{notice}</p>}
    {secret && <div className="mp-setup-notice" role="status"><div><b>Copy your signing secret now. It will not be shown again.</b><div className="mp-copy-address"><code>{secret}</code><CopyButton value={secret} label="Copy secret" /></div></div></div>}
    <section className="mp-table-card" style={{ padding: 16 }}>
      <h2>Endpoint</h2>
      {!loaded ? <p role="status">Loading…</p> : endpoint ? <dl><div><dt>URL</dt><dd><code>{endpoint.url}</code></dd></div><div><dt>Secret</dt><dd>whsec_…{endpoint.secretLast4}</dd></div></dl> : <p>No endpoint yet.</p>}
      <form className="mp-heading-actions" onSubmit={e => { e.preventDefault(); void save(); }}>
        <input aria-label="Endpoint URL" type="url" required pattern="https://.*" placeholder="https://example.com/furlpay/webhook" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="mp-button primary" disabled={busy || !url}>{endpoint ? <><RotateCcw size={15} />Replace and rotate secret</> : "Save endpoint"}</button>
      </form>
      {endpoint && <div className="mp-heading-actions">
        <button className="mp-button secondary" disabled={busy} onClick={() => void test()}><Send size={15} />Send test event</button>
        <button className="mp-button secondary" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />Remove endpoint</button>
      </div>}
    </section>
    <section className="mp-table-card"><div className="mp-table-heading"><div><h2>Recent deliveries</h2><span>Last 20 events · 5 attempts at 1 min, 10 min, 1 h, 6 h</span></div><button className="mp-icon-button" aria-label="Refresh" onClick={() => void load()}><RefreshCw size={16} /></button></div>
      {deliveries.length ? <div className="mp-table-scroll"><table><thead><tr><th>Event</th><th>Type</th><th>State</th><th>Attempts</th><th>Last error</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {deliveries.map(d => <tr key={d.id}><td><code>{d.id.slice(0, 8)}</code><small style={{ display: "block" }}>{new Date(d.created_at).toLocaleString()}</small></td><td>{d.type}</td><td>{d.state}</td><td>{d.attempts}</td><td><small>{d.last_error ?? ""}</small></td>
          <td>{d.state === "failed" && <button className="mp-button secondary" disabled={busy} onClick={() => void resend(d.id)}>Re-send</button>}</td></tr>)}
      </tbody></table></div> : <div className="mp-empty"><p>No events yet. Events appear when a payment is verified.</p></div>}
    </section>
    <section className="mp-table-card" style={{ padding: 16 }}><h2>Verify signatures</h2><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{VERIFY}</pre></section>
  </main></div>;
}
