import { useState } from "react";
import { isStepUpCode } from "@/lib/stepUp";
import { send } from "./shared";

// Step-up verification in the popup. Why a code to the account's own email,
// and why the popup never supplies the address: lib/stepUp.ts.

export default function StepUpPanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const r = await send<{ sentTo: string }>({ type: "STEP_UP_SEND" });
    setBusy(false);
    if (r.ok) setSentTo(r.data.sentTo);
    else setError(r.error === "no_email" ? "This account has no email. Verify on furlpay.com." : "Couldn't send the code. Try again.");
  }

  async function verify() {
    const c = code.replace(/\s+/g, "");
    if (!isStepUpCode(c)) return;
    setBusy(true);
    setError(null);
    const r = await send<{ verified: true }>({ type: "STEP_UP_VERIFY", code: c });
    setBusy(false);
    if (r.ok) onDone();
    else setError("That code didn't work. Check it, or send a new one.");
  }

  return (
    <div className="glass-panel" style={{ display: "grid", gap: 8, marginBottom: 10 }}>
      <b style={{ fontSize: "0.85rem" }}>Verify it&apos;s you</b>
      <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)" }}>
        This transaction needs an extra check. It stays valid for 15 minutes and covers one transaction.
      </div>
      {!sentTo ? (
        <button className="btn-primary" disabled={busy} onClick={() => void sendCode()}>
          {busy ? "Sending…" : "Email me a code"}
        </button>
      ) : (
        <>
          <div style={{ fontSize: "0.72rem", color: "var(--fp-text-muted)" }}>Code sent to {sentTo}.</div>
          <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
          <button className="btn-primary" disabled={busy || !isStepUpCode(code.replace(/\s+/g, ""))} onClick={() => void verify()}>
            {busy ? "Verifying…" : "Verify"}
          </button>
        </>
      )}
      {error && <div className="risk risk--high">{error}</div>}
      <button className="btn-ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
