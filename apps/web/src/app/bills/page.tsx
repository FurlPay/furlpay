"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { Bill } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import Modal from "@/components/Modal";

interface FxQuote {
  amountTo: number; feePct: number; rail: string; midMarketRate: number; savingsVsCompetitorPct: number; to: string;
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [tab, setTab] = useState<"bills" | "offramp">("bills");

  const load = useCallback(() => {
    getJSON<{ bills: Bill[] }>("/api/bills").then((r) => setBills(r.bills)).catch(console.error);
  }, []);
  useEffect(() => load(), [load]);

  async function payBill(id: string) {
    await sendJSON("/api/bills", { id, action: "pay" });
    load();
  }
  async function toggleAutopay(id: string) {
    await sendJSON("/api/bills", { id, action: "toggleAutopay" });
    load();
  }

  return (
    <>
      <PageHeader title="Bills & Off-ramp" />

      <div className="mx-5 mb-5 grid grid-cols-2 gap-2 rounded-pill bg-surface p-1">
        {(["bills", "offramp"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-pill py-2 text-sm font-semibold ${tab === t ? "bg-accent" : "text-textSecondary"}`}>
            {t === "bills" ? "Pay bills" : "Bank off-ramp"}
          </button>
        ))}
      </div>

      {tab === "bills" ? (
        !bills.length ? <Spinner /> : (
          <ul className="space-y-3 px-5">
            {bills.map((b) => (
              <li key={b.id} className="surface-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{b.provider}</p>
                    <p className="text-[13px] text-textSecondary capitalize">{b.category.replace("-", " ")} · due {b.dueDate}</p>
                  </div>
                  <p className="text-lg font-bold">{usd(b.balanceDue)}</p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button onClick={() => toggleAutopay(b.id)} className="flex items-center gap-2 text-[13px] text-textSecondary">
                    <span className={`relative h-5 w-9 rounded-full ${b.autopay ? "bg-accent" : "bg-white/15"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${b.autopay ? "left-[18px]" : "left-0.5"}`} />
                    </span>
                    Autopay (SMARTPay)
                  </button>
                  <button
                    onClick={() => payBill(b.id)}
                    disabled={b.balanceDue === 0}
                    className="rounded-pill bg-accent px-5 py-2 text-[13px] font-semibold disabled:opacity-40"
                  >
                    {b.balanceDue === 0 ? "Paid" : "Pay with USDC"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <OffRampPanel />
      )}
    </>
  );
}

function OffRampPanel() {
  const [amount, setAmount] = useState("500");
  const [to, setTo] = useState("EUR");
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const r = await sendJSON<{ quote: FxQuote }>("/api/offramp", { fromCurrency: "USD", toCurrency: to, amount: Number(amount) });
      setQuote(r.quote); setDone(false);
    } catch {
      setError("Couldn't fetch a quote. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  async function execute() {
    setBusy(true);
    setError(null);
    try {
      await sendJSON("/api/offramp", { fromCurrency: "USD", toCurrency: to, amount: Number(amount), execute: true });
      setDone(true);
    } catch {
      setError("Off-ramp failed — nothing was sent. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="px-5">
      <p className="mb-4 text-[13px] text-textSecondary">
        Off-ramp USDC to a local bank at the Wise mid-market rate + flat fee — no crypto spread.
      </p>
      <label className="mb-1 block text-[12px] text-textSecondary">You off-ramp (USDC)</label>
      <input type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} className="mb-3 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none" />

      <label className="mb-1 block text-[12px] text-textSecondary">Deposit to</label>
      <select value={to} onChange={(e) => { setTo(e.target.value); setQuote(null); }} className="mb-4 w-full rounded-2xl bg-surface px-4 py-3 font-semibold outline-none">
        {["EUR", "GBP", "INR", "BRL", "USD"].map((c) => <option key={c}>{c}</option>)}
      </select>

      {quote && (
        <div className="mb-4 space-y-1 rounded-2xl bg-white/[0.04] p-4 text-[13px] text-textSecondary">
          <Row k="You receive" v={`${quote.amountTo.toLocaleString()} ${quote.to}`} />
          <Row k="Mid-market rate" v={String(quote.midMarketRate)} />
          <Row k="Fee" v={`${quote.feePct}%`} />
          <Row k="Rail" v={quote.rail} />
          <Row k="Saves vs RedotPay/Bridge" v={`~${quote.savingsVsCompetitorPct}%`} />
        </div>
      )}

      {error && <p className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>}

      {done ? (
        <div className="rounded-pill bg-gain/15 py-3.5 text-center font-semibold text-gain">Off-ramp sent via {quote?.rail} </div>
      ) : !quote ? (
        <button onClick={getQuote} disabled={busy || !(Number(amount) > 0)} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
          {busy ? "Quoting…" : "Get quote"}
        </button>
      ) : (
        <button onClick={execute} disabled={busy} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
          {busy ? "Sending…" : "Confirm off-ramp"}
        </button>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span>{k}</span><span className="text-textPrimary">{v}</span></div>;
}
