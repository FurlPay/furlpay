import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { PayableAddress } from "@/lib/receiveAddress";
import {
  RAMP_CHAINS,
  RAMP_FIATS,
  parseRampAmount,
  quoteSourceLabel,
  rampErrorMessage,
  type RampChain,
  type RampFiat,
  type RampQuote,
} from "@/lib/ramp";
import { send } from "./shared";

// Buy / sell USDC through Coinbase's hosted checkout, opened in a new tab.
// Rules and the reasons for what is absent (no polling, no bank form) are in
// lib/ramp.ts and native-app/lib/ramp.ts.

type Mode = "buy" | "sell";

export default function RampPanel({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("buy");
  const [amountText, setAmountText] = useState("50");
  const [fiat, setFiat] = useState<RampFiat>("USD");
  const [chain, setChain] = useState<RampChain>("base");
  const [address, setAddress] = useState<PayableAddress | null>(null);
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    void send<PayableAddress>({ type: "GET_RECEIVE_ADDRESS" }).then((r) =>
      setAddress(r.ok ? r.data : { ok: false, reason: "no_wallet_linked" })
    );
  }, []);

  const amount = parseRampAmount(amountText);

  // Debounced quote; a sequence number drops responses that arrive late.
  useEffect(() => {
    setQuote(null);
    setQuoteNote(null);
    if (mode !== "buy" || amount === null) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void send<RampQuote>({ type: "RAMP_QUOTE", fiatAmount: amount, fiatCurrency: fiat, chain }).then((r) => {
        if (mine !== seq.current) return;
        if (r.ok) setQuote(r.data);
        else setQuoteNote(rampErrorMessage(r.error, "buy"));
      });
    }, 500);
    return () => clearTimeout(t);
  }, [mode, amount, fiat, chain]);

  async function checkout() {
    if (amount === null || !address?.ok) return;
    setBusy(true);
    setError(null);
    const r = await send<{ opened: true }>({
      type: "RAMP_CHECKOUT",
      direction: mode,
      amount,
      fiatCurrency: fiat,
      chain,
      address: address.address,
    });
    setBusy(false);
    if (r.ok) setOpened(true);
    else setError(rampErrorMessage(r.error, mode));
  }

  return (
    <div style={{ padding: "0 14px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} />
        </button>
        <h3 className="section-title" style={{ margin: 0 }}>Buy &amp; sell crypto</h3>
      </div>

      <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
        {(["buy", "sell"] as const).map((m) => (
          <button key={m} className={mode === m ? "active" : ""} onClick={() => { setMode(m); setOpened(false); setError(null); }}>
            {m === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {address && !address.ok ? (
        <div className="glass-panel">Link your FurlPay wallet in the app first. Crypto you buy is delivered to it.</div>
      ) : (
        <>
          <div className="glass-panel" style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)" }}>
              {mode === "buy" ? `Amount (${fiat})` : "Amount (USDC)"}
              <input className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            </label>
            {amount === null && <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>Enter between 1 and 50,000.</div>}
            {mode === "buy" && (
              <div className="seg">
                {RAMP_FIATS.map((f) => (
                  <button key={f} className={fiat === f ? "active" : ""} onClick={() => setFiat(f)}>{f}</button>
                ))}
              </div>
            )}
            <div className="seg">
              {RAMP_CHAINS.map((c) => (
                <button key={c} className={chain === c ? "active" : ""} onClick={() => setChain(c)} style={{ textTransform: "capitalize" }}>{c}</button>
              ))}
            </div>
          </div>

          {mode === "buy" ? (
            <div className="glass-panel" style={{ marginBottom: 10, fontSize: "0.78rem" }}>
              {quote ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>You receive (est.)</span>
                    <b style={{ fontFamily: "var(--fp-font-mono)" }}>{quote.cryptoAmount.toFixed(2)} USDC</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--fp-text-muted)" }}>
                    <span>Fees</span>
                    <span style={{ fontFamily: "var(--fp-font-mono)" }}>{quote.fees.total.toFixed(2)} {fiat}</span>
                  </div>
                  <div style={{ marginTop: 6, color: quote.source === "coinbase" ? "var(--fp-text-muted)" : "var(--fp-warning)", fontSize: "0.7rem" }}>
                    {quoteSourceLabel(quote)}
                  </div>
                </>
              ) : (
                <span style={{ color: "var(--fp-text-muted)" }}>{quoteNote ?? (amount === null ? "Enter an amount." : "Getting a price…")}</span>
              )}
            </div>
          ) : (
            <div className="glass-panel" style={{ marginBottom: 10, fontSize: "0.74rem", color: "var(--fp-text-secondary)" }}>
              Coinbase pays out to the bank account or card you choose on its page and shows the rate and fees before you confirm.
              Selling crypto can be taxable, including 1% TDS in India. FurlPay does not give tax advice.
            </div>
          )}

          {error && <div className="risk risk--high" style={{ marginBottom: 10 }}>{error}</div>}
          {opened && (
            <div className="risk risk--safe" style={{ marginBottom: 10 }}>
              Coinbase checkout opened in a new tab. {mode === "buy" ? "USDC appears in your wallet when it lands on-chain." : "Coinbase handles the payout; its receipt has the status."}
            </div>
          )}

          <button className="btn-primary" style={{ width: "100%" }} disabled={amount === null || busy || !address} onClick={() => void checkout()}>
            {busy ? "Opening…" : mode === "buy" ? "Continue to Coinbase" : "Sell with Coinbase"}
          </button>
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)", textAlign: "center", marginTop: 8 }}>
            Payments are processed by Coinbase under its terms and identity checks. FurlPay never sees your card or bank details.
          </div>
        </>
      )}
    </div>
  );
}
