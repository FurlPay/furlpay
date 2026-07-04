"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { FiatBalance } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { PlusIcon, ArrowUp, ArrowDown, SwapIcon, CheckIcon } from "@/components/icons";
import { Copy } from "lucide-react";
import Modal from "@/components/Modal";

// Mid-market rates to USD (mock; a live build pulls Wise/FX quotes).
const TO_USD: Record<string, number> = { USD: 1, EUR: 1.09, GBP: 1.27, INR: 0.012, JPY: 0.0064 };
const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };

// Local payment rails per currency (what a sender uses to pay you).
const RAILS: Record<string, string[]> = {
  EUR: ["SEPA Instant", "SEPA", "SWIFT"],
  USD: ["ACH", "Wire", "SWIFT"],
  GBP: ["Faster Payments", "SWIFT"],
  INR: ["UPI", "IMPS", "SWIFT"],
};

// Furlpay Direct — send straight into these apps/banks (RedotPay-style).
const DIRECT = ["PayPal", "Revolut", "Wise", "Cash App", "Monzo", "Chase", "Remitly", "Paysend"];

function sym(c: string) {
  return SYMBOL[c] ?? c + " ";
}
function convert(amount: number, from: string, to: string) {
  const usdVal = amount * (TO_USD[from] ?? 1);
  return usdVal / (TO_USD[to] ?? 1);
}

export default function BankingPage() {
  const [accounts, setAccounts] = useState<FiatBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "send" | "receive" | "convert" | "direct">(null);

  const load = useCallback(() => {
    getJSON<{ accounts: FiatBalance[] }>("/api/banking").then((r) => setAccounts(r.accounts));
  }, []);
  useEffect(() => load(), [load]);

  async function provision(currency: string) {
    setBusy(true);
    try {
      await sendJSON("/api/banking", { currency });
      load();
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  }

  if (!accounts.length) return <Spinner />;

  const totalUsd = accounts.reduce((s, a) => s + a.usdValue, 0);
  const missing = ["USD", "EUR", "GBP", "INR"].filter((c) => !accounts.find((a) => a.currency === c));

  return (
    <>
      <PageHeader title="Banking" right={<Pill tone="accent">Wise · BaaS</Pill>} />

      {/* Balance hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <p className="text-[13px] text-white/70">Total across accounts</p>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tighter">{usd(totalUsd)}</p>
          <p className="mt-2 text-[12px] text-white/60">
            {accounts.length} local accounts · send to 140+ countries · 64% arrive in under 20s
          </p>
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-5 grid grid-cols-4 gap-3 px-5">
        <Action label="Send" onClick={() => setModal("send")}><ArrowUp className="h-5 w-5" /></Action>
        <Action label="Receive" onClick={() => setModal("receive")}><ArrowDown className="h-5 w-5" /></Action>
        <Action label="Convert" onClick={() => setModal("convert")}><SwapIcon className="h-5 w-5" /></Action>
        <Action label="Direct" onClick={() => setModal("direct")}><ArrowUp className="h-5 w-5 rotate-45" /></Action>
      </section>

      {/* Accounts */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 text-[17px] font-bold tracking-tight">Your accounts</h2>
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.currency} className="surface-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-[13px] font-bold">{sym(a.currency)}</span>
                    <p className="text-[13px] text-textSecondary">{a.currency} account</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold">
                    {a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
                    <span className="text-base font-medium text-textSecondary">{a.currency}</span>
                  </p>
                  <p className="text-[12px] text-textMuted">≈ {usd(a.usdValue)}</p>
                </div>
              </div>
              {(RAILS[a.currency] ?? ["SWIFT"]).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(RAILS[a.currency] ?? ["SWIFT"]).map((r) => (
                    <span key={r} className="rounded-full bg-neon/10 px-2 py-0.5 text-[10px] font-semibold text-neon">{r}</span>
                  ))}
                </div>
              )}
              {a.localDetails && (
                <div className="mt-3 space-y-1.5 rounded-2xl bg-white/[0.04] p-3">
                  {Object.entries(a.localDetails).map(([k, v]) => (
                    <button key={k} onClick={() => copy(String(v))} className="flex w-full items-center justify-between text-left text-[13px]">
                      <span className="capitalize text-textSecondary">{k.replace(/([A-Z])/g, " $1")}</span>
                      <span className="flex items-center gap-1.5 font-mono">
                        {String(v)}
                        {copied === String(v) ? <CheckIcon className="h-3.5 w-3.5 text-neon" /> : <Copy className="h-3.5 w-3.5 text-textMuted" />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Furlpay Direct */}
      <section className="mt-7 px-5">
        <h2 className="mb-1 text-[17px] font-bold tracking-tight">Furlpay Direct</h2>
        <p className="mb-3 text-[12px] text-textSecondary">Send money straight into other apps &amp; banks.</p>
        <div className="grid grid-cols-4 gap-2">
          {DIRECT.map((d) => (
            <button key={d} onClick={() => setModal("direct")} className="tap surface-card flex flex-col items-center gap-1.5 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-[13px] font-bold">{d[0]}</span>
              <span className="text-[10px] text-textSecondary">{d}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Open new account */}
      {missing.length > 0 && (
        <section className="mt-7 px-5">
          <h2 className="mb-2 text-[17px] font-bold tracking-tight">Open a new account</h2>
          <div className="flex flex-wrap gap-2">
            {missing.map((c) => (
              <button key={c} disabled={busy} onClick={() => provision(c)} className="tap flex items-center gap-1.5 rounded-pill border border-surfaceMuted bg-surface px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
                <PlusIcon className="h-4 w-4" /> {c}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-textMuted">
            Virtual IBAN / routing are sub-accounts under Furlpay&apos;s BaaS partner (Cross River / Wise),
            held in FDIC-insured or safeguarded omnibus accounts.
          </p>
        </section>
      )}

      {modal === "send" && <SendModal accounts={accounts} onClose={() => setModal(null)} />}
      {modal === "receive" && <ReceiveModal accounts={accounts} onClose={() => setModal(null)} />}
      {modal === "convert" && <ConvertModal accounts={accounts} onClose={() => setModal(null)} />}
      {modal === "direct" && <DirectModal accounts={accounts} onClose={() => setModal(null)} />}
    </>
  );
}

function Action({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tap app-tile flex flex-col items-center gap-2 py-3.5">
      <span className="app-tile-icon h-11 w-11">{children}</span>
      <span className="text-[12px] font-semibold tracking-tight">{label}</span>
    </button>
  );
}

function Success({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="py-4 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neon/15 text-neon">
        <CheckIcon className="h-6 w-6" />
      </span>
      <p className="text-[15px] font-semibold">{text}</p>
      <button onClick={onClose} className="mt-5 w-full rounded-pill bg-accent py-3 font-semibold">Done</button>
    </div>
  );
}

function SendModal({ accounts, onClose }: { accounts: FiatBalance[]; onClose: () => void }) {
  const [from, setFrom] = useState(accounts[0].currency);
  const [rail, setRail] = useState((RAILS[accounts[0].currency] ?? ["SWIFT"])[0]);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("100");
  const [done, setDone] = useState(false);

  const rails = RAILS[from] ?? ["SWIFT"];
  const amt = Number(amount) || 0;
  const feePct = rail === "SWIFT" ? 0.012 : 0.004;
  const fee = Math.max(0.2, amt * feePct);
  const arrival = rail.includes("Instant") || rail === "UPI" || rail === "Faster Payments" ? "in seconds" : rail === "SWIFT" ? "1–2 business days" : "same day";

  return (
    <Modal open title="Send money" onClose={onClose}>
      {done ? (
        <Success text={`Sent ${sym(from)}${amt.toLocaleString()} via ${rail}.`} onClose={onClose} />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select label="From" value={from} onChange={(v) => { setFrom(v); setRail((RAILS[v] ?? ["SWIFT"])[0]); }} options={accounts.map((a) => a.currency)} />
            <Select label="Rail" value={rail} onChange={setRail} options={rails} />
          </div>
          <Field label="Recipient (IBAN / account / email)">
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="DE89 3704 0044 0532 0130 00" className={inputCls} />
          </Field>
          <Field label={`Amount (${from})`}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <div className="rounded-2xl bg-white/[0.04] p-3 text-[13px]">
            <Row k="Fee" v={`${sym(from)}${fee.toFixed(2)}`} />
            <Row k="Arrives" v={arrival} />
            <Row k="Recipient gets" v={`${sym(from)}${Math.max(0, amt - fee).toFixed(2)}`} bold />
          </div>
          <button onClick={() => setDone(true)} disabled={!to.trim() || amt <= 0} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            Send {sym(from)}{amt.toLocaleString()}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ReceiveModal({ accounts, onClose }: { accounts: FiatBalance[]; onClose: () => void }) {
  const [cur, setCur] = useState(accounts[0].currency);
  const acct = accounts.find((a) => a.currency === cur)!;
  const [copied, setCopied] = useState<string | null>(null);
  function copy(t: string) { navigator.clipboard?.writeText(t); setCopied(t); setTimeout(() => setCopied(null), 1200); }
  return (
    <Modal open title="Receive money" onClose={onClose}>
      <Select label="Currency" value={cur} onChange={setCur} options={accounts.map((a) => a.currency)} />
      <p className="mt-3 text-[13px] text-textSecondary">Share these details to get paid via {(RAILS[cur] ?? ["SWIFT"]).join(" / ")}.</p>
      <div className="mt-3 space-y-1.5 rounded-2xl bg-white/[0.04] p-3">
        {acct.localDetails && Object.entries(acct.localDetails).map(([k, v]) => (
          <button key={k} onClick={() => copy(String(v))} className="flex w-full items-center justify-between text-left text-[13px]">
            <span className="capitalize text-textSecondary">{k.replace(/([A-Z])/g, " $1")}</span>
            <span className="font-mono">{copied === String(v) ? "Copied" : String(v)}</span>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-5 w-full rounded-pill bg-accent py-3 font-semibold">Done</button>
    </Modal>
  );
}

function ConvertModal({ accounts, onClose }: { accounts: FiatBalance[]; onClose: () => void }) {
  const [from, setFrom] = useState(accounts[0].currency);
  const [to, setTo] = useState(accounts[1]?.currency ?? "USD");
  const [amount, setAmount] = useState("100");
  const [done, setDone] = useState(false);
  const amt = Number(amount) || 0;
  const out = convert(amt, from, to);
  const rate = convert(1, from, to);
  return (
    <Modal open title="Convert" onClose={onClose}>
      {done ? (
        <Success text={`Converted ${sym(from)}${amt.toLocaleString()} → ${sym(to)}${out.toFixed(2)}.`} onClose={onClose} />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select label="From" value={from} onChange={setFrom} options={accounts.map((a) => a.currency)} />
            <Select label="To" value={to} onChange={setTo} options={["USD", "EUR", "GBP", "INR"]} />
          </div>
          <Field label={`Amount (${from})`}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <div className="rounded-2xl bg-white/[0.04] p-3 text-[13px]">
            <Row k="Rate (mid-market)" v={`1 ${from} = ${rate.toFixed(4)} ${to}`} />
            <Row k="You get" v={`${sym(to)}${out.toFixed(2)}`} bold />
          </div>
          <button onClick={() => setDone(true)} disabled={from === to || amt <= 0} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            Convert
          </button>
        </div>
      )}
    </Modal>
  );
}

function DirectModal({ accounts, onClose }: { accounts: FiatBalance[]; onClose: () => void }) {
  const [app, setApp] = useState(DIRECT[0]);
  const [amount, setAmount] = useState("50");
  const [done, setDone] = useState(false);
  const amt = Number(amount) || 0;
  return (
    <Modal open title="Furlpay Direct" onClose={onClose}>
      {done ? (
        <Success text={`Sent $${amt.toLocaleString()} to ${app}.`} onClose={onClose} />
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-textSecondary">Send from your balance straight into another app or bank.</p>
          <Select label="Destination" value={app} onChange={setApp} options={DIRECT} />
          <Field label="Amount (USD)">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <div className="rounded-2xl bg-white/[0.04] p-3 text-[13px]">
            <Row k="Fee" v="$0.00" />
            <Row k="Arrives" v="in minutes" />
          </div>
          <button onClick={() => setDone(true)} disabled={amt <= 0} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            Send to {app}
          </button>
        </div>
      )}
    </Modal>
  );
}

const inputCls = "w-full rounded-2xl bg-surface px-4 py-3 text-[15px] outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-textSecondary">{label}</span>
      {children}
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-[12px] text-textSecondary">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl bg-surface px-3 py-3 text-[14px] font-semibold outline-none">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-textSecondary">{k}</span>
      <span className={bold ? "font-bold" : ""}>{v}</span>
    </div>
  );
}
