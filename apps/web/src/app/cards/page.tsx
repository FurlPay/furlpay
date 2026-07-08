"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { PaymentCard, Transaction } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { EyeIcon, GearIcon, PlusIcon, SlidersIcon, SnowflakeIcon, LockIcon, CloseIcon } from "@/components/icons";
import VisaCard from "@/components/VisaCard";
import TransactionList from "@/components/TransactionList";
import Modal from "@/components/Modal";

export default function CardsPage() {
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [active, setActive] = useState(0);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [modal, setModal] = useState<null | "view" | "limits" | "settings" | "escrow">(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const loadCards = useCallback(async () => {
    const r = await getJSON<{ cards: PaymentCard[] }>("/api/cards");
    setCards(r.cards);
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  const card = cards[active];

  const loadTxs = useCallback(async (cardId: string) => {
    const r = await getJSON<{ transactions: Transaction[] }>(`/api/transactions?cardId=${cardId}`);
    setTxs(r.transactions);
  }, []);

  useEffect(() => { if (card) loadTxs(card.id); }, [card, loadTxs]);

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== active) setActive(idx);
  }

  async function patchCard(patch: Partial<PaymentCard> & { id: string }) {
    // Canonical Marqeta-style controls endpoint (id→cardId, frozen→freeze).
    const { id, frozen, ...rest } = patch;
    const body: Record<string, unknown> = { cardId: id, ...rest };
    if (typeof frozen === "boolean") body.freeze = frozen;
    const r = await sendJSON<{ card: PaymentCard }>("/api/cards/settings", body);
    setCards((cs) => cs.map((c) => (c.id === r.card.id ? r.card : c)));
  }

  if (!cards.length) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Cards"
        right={
          <div className="flex items-center gap-2">
            <a
              href="/cards/approve"
              className="flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm text-white/80"
            >
              Approvals
            </a>
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08]">
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>
        }
      />

      {/* Swipable carousel */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth px-5"
      >
        {cards.map((c) => (
          <div key={c.id} className="w-full shrink-0 snap-center pr-4 last:pr-0">
            <VisaCard card={c} />
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="mt-3 flex justify-center gap-1.5">
        {cards.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-accent" : "w-1.5 bg-white/25"}`} />
        ))}
      </div>

      {/* Circular action buttons */}
      <div className="mt-5 flex justify-around px-5">
        <CircleAction label="View" onClick={() => setModal("view")}><EyeIcon /></CircleAction>
        <CircleAction
          label={card.frozen ? "Unfreeze" : "Freeze"}
          active={card.frozen}
          onClick={() => patchCard({ id: card.id, frozen: !card.frozen })}
        >
          <SnowflakeIcon />
        </CircleAction>
        <CircleAction label="Limits" onClick={() => setModal("limits")}><SlidersIcon /></CircleAction>
        <CircleAction label="Settings" onClick={() => setModal("settings")}><GearIcon /></CircleAction>
      </div>

      {/* Push provisioning */}
      <div className="mt-6 px-5">
        <button className="flex w-full items-center justify-center gap-2 rounded-pill border border-surfaceMuted bg-surface py-3.5 font-medium">
           Add to Apple / Google Wallet
        </button>
      </div>

      {/* Tier promo banner */}
      <div className="mt-4 px-5">
        <div className="flex items-center justify-between rounded-xl p-4"
          style={{ background: "linear-gradient(135deg,#1C0F35 0%,#0F0922 100%)" }}>
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-black">PRO</span>
            <p className="text-[13px] font-medium">3% cashback with Apple Pay & Google Pay</p>
          </div>
          <button className="text-textSecondary"><CloseIcon className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Daily limit usage + escrow trigger */}
      <div className="mt-6 grid grid-cols-2 gap-3 px-5">
        <div className="surface-card p-4">
          <p className="text-[12px] text-textSecondary">Daily spent</p>
          <p className="mt-1 font-bold">{usd(card.limits.dailySpent)} <span className="text-textSecondary">/ {usd(card.limits.daily)}</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-white/10">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (card.limits.dailySpent / card.limits.daily) * 100)}%` }} />
          </div>
        </div>
        <button onClick={() => setModal("escrow")} className="surface-card p-4 text-left">
          <p className="text-[12px] text-textSecondary">Pre-auth holds</p>
          <p className="mt-1 font-bold text-accent">Escrow center →</p>
          <p className="mt-2 text-[11px] text-textMuted">Hotel & rental holds</p>
        </button>
      </div>

      {/* Card transactions */}
      <section className="mt-8">
        <h2 className="mb-2 px-5 text-lg font-bold">Transactions</h2>
        <TransactionList items={txs} />
      </section>

      {modal === "view" && <ViewModal card={card} onClose={() => setModal(null)} />}
      {modal === "limits" && <LimitsModal card={card} onSave={patchCard} onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal card={card} onSave={patchCard} onClose={() => setModal(null)} />}
      {modal === "escrow" && <EscrowModal cardId={card.id} onClose={() => setModal(null)} onDone={() => loadTxs(card.id)} />}
    </>
  );
}

function CircleAction({ label, children, onClick, active }: { label: string; children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${active ? "bg-accent text-white" : "bg-white/[0.08] text-white"}`}>
        {children}
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}

function ViewModal({ card, onClose }: { card: PaymentCard; onClose: () => void }) {
  // Biometric re-auth gate for a high-risk action (2026 fintech UX best practice).
  const [authed, setAuthed] = useState(false);
  const [authing, setAuthing] = useState(false);

  function authenticate() {
    setAuthing(true);
    // Simulates a WebAuthn/passkey user-verification ceremony.
    setTimeout(() => { setAuthed(true); setAuthing(false); }, 700);
  }

  return (
    <Modal open title="Card details" onClose={onClose}>
      {!authed ? (
        <div className="py-4 text-center">
          <LockIcon className="mx-auto mb-3 h-10 w-10 text-accent" />
          <p className="mb-5 text-[13px] text-textSecondary">
            Revealing full card details requires Face ID / Touch ID.
          </p>
          <button onClick={authenticate} disabled={authing} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            {authing ? "Authenticating…" : "Authenticate to reveal"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Card number" value={`4111 5522 8834 ${card.last4}`} mono />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expiry" value="09 / 29" mono />
            <Field label="CVV" value="284" mono />
          </div>
          <Field label="Network" value={card.network} />
        </div>
      )}
    </Modal>
  );
}

function LimitsModal({ card, onSave, onClose }: { card: PaymentCard; onSave: (p: Partial<PaymentCard> & { id: string }) => void; onClose: () => void }) {
  const [perPurchase, setPer] = useState(card.limits.perPurchase);
  const [daily, setDaily] = useState(card.limits.daily);
  return (
    <Modal open title="Spending limits" onClose={onClose}>
      <SliderRow label="Per-purchase limit" value={perPurchase} max={10000} onChange={setPer} />
      <SliderRow label="Daily limit" value={daily} max={20000} onChange={setDaily} />
      <button
        onClick={() => { onSave({ id: card.id, limits: { ...card.limits, perPurchase, daily } }); onClose(); }}
        className="mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold"
      >
        Save limits
      </button>
    </Modal>
  );
}

function SettingsModal({ card, onSave, onClose }: { card: PaymentCard; onSave: (p: Partial<PaymentCard> & { id: string }) => void; onClose: () => void }) {
  const [channels, setChannels] = useState(card.channels);
  const [currency, setCurrency] = useState(card.settlementCurrency);
  const toggle = (k: keyof typeof channels) => setChannels((c) => ({ ...c, [k]: !c[k] }));
  return (
    <Modal open title="Card settings" onClose={onClose}>
      <div className="space-y-2">
        <ToggleRow label="Online transactions" on={channels.online} onClick={() => toggle("online")} />
        <ToggleRow label="Offline (POS) transactions" on={channels.offline} onClick={() => toggle("offline")} />
        <ToggleRow label="ATM withdrawals" on={channels.atm} onClick={() => toggle("atm")} />
      </div>
      <div className="mt-4">
        <label className="mb-1 block text-[12px] text-textSecondary">Settlement currency</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-2xl bg-surface px-4 py-3 font-semibold outline-none">
          {["USD", "EUR", "GBP", "INR"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <button
        onClick={() => { onSave({ id: card.id, channels, settlementCurrency: currency }); onClose(); }}
        className="mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold"
      >
        Save settings
      </button>
    </Modal>
  );
}

function EscrowModal({ cardId, onClose, onDone }: { cardId: string; onClose: () => void; onDone: () => void }) {
  const [holds, setHolds] = useState<any[]>([]);
  const [merchant, setMerchant] = useState("Marriott Hotels");
  const [amount, setAmount] = useState("150");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getJSON<{ holds: any[] }>("/api/escrow");
      setHolds(r.holds);
    } catch {
      setError("Couldn't load holds.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(op: () => Promise<unknown>, failMsg: string) {
    setBusy(true);
    setError(null);
    try {
      await op();
      await load();
      onDone();
    } catch {
      setError(failMsg);
    } finally {
      setBusy(false);
    }
  }
  const create = () =>
    run(
      () => sendJSON("/api/escrow", { action: "create", cardId, merchant, amount: Number(amount) }),
      "Couldn't create the hold. Try again."
    );
  const capture = (id: string, authorized: number) =>
    run(
      () => sendJSON("/api/escrow", { action: "capture", id, finalAmount: Math.round(authorized * 0.8 * 100) / 100 }),
      "Couldn't capture the hold. Try again."
    );
  const release = (id: string) =>
    run(() => sendJSON("/api/escrow", { action: "release", id }), "Couldn't release the hold. Try again.");

  return (
    <Modal open title="Pre-authorization escrow" onClose={onClose}>
      <p className="mb-4 text-[13px] text-textSecondary">
        Exact hold amount is locked in a time-locked escrow contract (max 7 days), not your whole Safe.
      </p>
      <div className="mb-3 flex gap-2">
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="flex-1 rounded-2xl bg-surface px-4 py-3 text-sm outline-none" />
        <input type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 rounded-2xl bg-surface px-4 py-3 text-sm outline-none" />
      </div>
      {error && <p className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>}
      <button onClick={create} disabled={busy || !merchant.trim() || !(Number(amount) > 0)} className="mb-4 w-full rounded-pill bg-accent py-3 font-semibold disabled:opacity-50">
        {busy ? "Working…" : "Create hold"}
      </button>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {holds.map((h) => (
          <div key={h.id} className="rounded-2xl bg-white/[0.04] p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{h.merchant}</p>
              <Pill tone={h.status === "held" ? "accent" : "muted"}>{h.status}</Pill>
            </div>
            <p className="mt-1 text-[13px] text-textSecondary">
              Auth {usd(h.authorizedAmount)}
              {h.capturedAmount != null && ` · captured ${usd(h.capturedAmount)}`}
            </p>
            {h.status === "held" && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => capture(h.id, h.authorizedAmount)} disabled={busy} className="flex-1 rounded-pill bg-white/10 py-2 text-[13px] font-semibold disabled:opacity-50">Capture 80%</button>
                <button onClick={() => release(h.id)} disabled={busy} className="flex-1 rounded-pill bg-white/10 py-2 text-[13px] font-semibold disabled:opacity-50">Release</button>
              </div>
            )}
          </div>
        ))}
        {!holds.length && <p className="py-4 text-center text-sm text-textSecondary">No active holds.</p>}
      </div>
    </Modal>
  );
}

// --- small shared bits ---
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3">
      <p className="text-[11px] text-textSecondary">{label}</p>
      <p className={`mt-0.5 ${mono ? "font-mono tracking-wide" : "font-semibold"}`}>{value}</p>
    </div>
  );
}

function SliderRow({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between">
        <span className="text-[13px] text-textSecondary">{label}</span>
        <span className="font-semibold">{usd(value)}</span>
      </div>
      <input type="range" min={100} max={max} step={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#FF3B30]" />
    </div>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3">
      <span className="text-[14px]">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
