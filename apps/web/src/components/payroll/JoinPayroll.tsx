"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";

// Accept a payroll invite. The token arrives in the URL fragment (#t=…), which
// browsers never send to a server; it is kept in sessionStorage across the
// sign-in round trip and POSTed only to the invite API.
type Preview = { name: string; role: string; chain: string; emailMatches: boolean; invitedEmail: string };
const KEY = "furlpay.payroll.invite";

async function call(token: string, action: "preview" | "accept") {
  const res = await fetch("/api/payouts/payroll/invite", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }) });
  if (res.status === 401) { window.location.assign("/login?next=/payroll/join"); return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

export default function JoinPayroll() {
  const [token, setToken] = useState(""); const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let t = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? "";
    try { if (t) sessionStorage.setItem(KEY, t); else t = sessionStorage.getItem(KEY) ?? ""; } catch { /* storage blocked: the fragment still works this visit */ }
    if (t && window.location.hash) history.replaceState(null, "", window.location.pathname);
    setToken(t);
    if (!t) { setError("This invite link is incomplete. Open the full link you were sent."); return; }
    void call(t, "preview").then(p => p && setPreview(p)).catch(e => setError((e as Error).message));
  }, []);
  async function accept() {
    setBusy(true); setError("");
    try {
      if (await call(token, "accept")) { setDone(true); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="os mp-workspace"><main className="mp-main" style={{ maxWidth: 560, margin: "48px auto" }}>
    <Link className="mp-brand" href="/"><FurlPayMark size={27} /><b>FurlPay</b><span>Payroll</span></Link>
    <div className="mp-detail" style={{ marginTop: 24 }}>
      <span className="mp-eyebrow">PAYROLL INVITE</span>
      {done ? <><h1><CheckCircle2 size={22} /> You&apos;re linked</h1><p>Next, set the wallet you&apos;ll be paid to. Your wallet signs to prove it&apos;s yours, and your employer can&apos;t change it after that.</p>
        <Link className="mp-button primary" href="/payroll/me">Set your payout wallet</Link></>
      : preview ? <><h1>Join payroll as {preview.name}</h1>
        <dl><div><dt>Role</dt><dd>{preview.role || "—"}</dd></div><div><dt>Paid in USDC on</dt><dd>{preview.chain}</dd></div><div><dt>Invite sent to</dt><dd>{preview.invitedEmail}</dd></div></dl>
        {preview.emailMatches ? <button className="mp-button primary" disabled={busy} onClick={() => void accept()}><ShieldCheck size={15} />{busy ? "Linking…" : "Accept invite"}</button>
          : <p className="mp-error" role="alert">You&apos;re signed in with a different email. Sign in as {preview.invitedEmail} to accept.</p>}</>
      : !error && <p role="status">Checking your invite…</p>}
      {error && <p className="mp-error" role="alert">{error}</p>}
    </div>
  </main></div>;
}
