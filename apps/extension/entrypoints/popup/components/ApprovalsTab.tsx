import { useCallback, useEffect, useState } from "react";
import { Icon, IconName } from "@/components/icons";
import { assessChallenge, clockLabel, dayLabel, mccLabel, txStatusMeta } from "@/lib/market";
import type { PasskeyList, PendingChallenge, Transaction } from "@/lib/types";
import {
  ErrorPanel,
  MerchantAvatar,
  SettingsTile,
  SkeletonPage,
  openSite,
  send,
  useNow,
  usd,
} from "./shared";

// 3DS2 approvals — the fear moment, designed first. Verdicts (FurlPay
// Protect), countdowns, and outcome simulation ("if approved / if declined")
// follow 2026 wallet trust practice (Phantom/Rabby/Blockaid).

export default function ApprovalsTab({ onCount }: { onCount: (n: number) => void }) {
  const [challenges, setChallenges] = useState<PendingChallenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then((r) => {
      if (r.ok) {
        setChallenges(r.data.challenges);
        onCount(r.data.challenges.length);
        setError(null);
      } else setError(r.error);
    });
  }, [onCount]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!challenges) return <SkeletonPage rows={2} label="Checking pending approvals…" />;

  const live = challenges.filter((c) => new Date(c.expiresAt).getTime() > now);

  return (
    <div style={{ padding: "0 14px" }}>
      <h3 className="section-title">Waiting for your approval</h3>
      {live.length === 0 && <ApprovalsIdle />}
      {live.map((c) => (
        <ApprovalCard
          key={c.id}
          challenge={c}
          now={now}
          busy={busy === c.id}
          anyBusy={busy !== null}
          onDecline={async () => {
            setBusy(c.id);
            const r = await send({ type: "DECLINE_CHALLENGE", challengeId: c.id });
            if (!r.ok) setError(r.error);
            setBusy(null);
            load();
          }}
          onApprove={() => send({ type: "OPEN_APPROVE", challengeId: c.id })}
        />
      ))}
      {live.length > 0 && (
        <p style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", fontSize: "0.68rem", color: "var(--fp-text-muted)", marginTop: 2 }}>
          <Icon name="security" size={13} /> Protected by FurlPay — passkeys sign on furlpay.com, spoof-proof by design.
        </p>
      )}

      <ApprovalHistory />
      <HowApprovalsWork />
      <ApprovalDevices />
    </div>
  );
}

/** Calm empty state — shield mark, one-line explanation, useful action. */
function ApprovalsIdle() {
  return (
    <div className="glass-panel fade-up" style={{ textAlign: "center", padding: "22px 18px", marginBottom: 12 }}>
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--fp-accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 10px", display: "block", opacity: 0.9 }} aria-hidden="true">
        <path d="M12 3l7.5 2.8v5.4c0 4.3-3.2 7.4-7.5 8.8-4.3-1.4-7.5-4.5-7.5-8.8V5.8L12 3z" fill="rgba(0,229,153,0.07)" />
        <path d="M8.8 12l2.2 2.2 4.2-4.4" />
      </svg>
      <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 4 }}>You're all clear</div>
      <div style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", lineHeight: 1.5, maxWidth: 260, margin: "0 auto 12px" }}>
        When a card payment needs 3-D Secure verification, it appears here instantly and as a system notification.
      </div>
      <button className="btn-ghost" style={{ padding: "8px 16px", fontSize: "0.78rem" }} onClick={() => openSite("/cards")}>
        Manage cards
      </button>
    </div>
  );
}

/** Recent card decisions pulled from the transaction feed. */
function ApprovalHistory() {
  const [items, setItems] = useState<Transaction[] | null>(null);
  useEffect(() => {
    send<{ transactions: Transaction[] }>({ type: "GET_TRANSACTIONS" }).then(
      (r) => r.ok && setItems(r.data.transactions.filter((t) => t.category === "card").slice(0, 4))
    );
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <>
      <h3 className="section-title" style={{ marginTop: 14 }}>Recent decisions</h3>
      <div className="glass-panel" style={{ padding: "4px 12px" }}>
        {items.map((tx) => {
          const st = txStatusMeta(tx.status);
          return (
            <div key={tx.id} className="tx-row" style={{ padding: "9px 0" }}>
              <MerchantAvatar name={tx.title} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: "0.8rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.title}</div>
                <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)" }}>
                  {tx.timestamp ? `${dayLabel(tx.timestamp)} · ${clockLabel(tx.timestamp)}` : tx.subtitle}
                </div>
              </div>
              <span className={`status-badge status-badge--${st.tone}`}>{st.tone === "loss" ? "Declined" : "Approved"}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function HowApprovalsWork() {
  const steps: { icon: IconName; text: string }[] = [
    { icon: "bell", text: "A merchant requests 3-D Secure — you get a notification here." },
    { icon: "security", text: "FurlPay Protect screens the amount, merchant and location first." },
    { icon: "passkey", text: "You approve with your fingerprint or Face ID — passkeys can't be phished." },
  ];
  return (
    <>
      <h3 className="section-title" style={{ marginTop: 14 }}>How approvals work</h3>
      <div className="glass-panel" style={{ padding: "10px 14px" }}>
        {steps.map((s, i) => (
          <div key={s.icon} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}>
            <span style={{ color: "var(--fp-accent)", display: "flex", marginTop: 1 }}>
              <Icon name={s.icon} size={15} />
            </span>
            <span style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", lineHeight: 1.45 }}>
              <b style={{ color: "var(--fp-text-primary)" }}>{i + 1}.</b> {s.text}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Devices that can approve — passkey count from the credentials API. */
function ApprovalDevices() {
  const [list, setList] = useState<PasskeyList | null>(null);
  useEffect(() => {
    send<PasskeyList>({ type: "GET_PASSKEYS" }).then((r) => r.ok && setList(r.data));
  }, []);
  return (
    <>
      <h3 className="section-title" style={{ marginTop: 14 }}>Devices</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 14 }}>
        <SettingsTile
          icon="passkey"
          label={list ? `${list.credentials.length} passkey${list.credentials.length === 1 ? "" : "s"} can approve` : "Passkeys"}
          sub={list?.credentials[0] ? `Latest: ${list.credentials[0].name}` : "Biometric devices bound to your account"}
          onClick={() => openSite("/profile#security")}
          chevron
        />
      </div>
    </>
  );
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // issuer window used for the countdown bar

function ApprovalCard({
  challenge: c,
  now,
  busy,
  anyBusy,
  onDecline,
  onApprove,
}: {
  challenge: PendingChallenge;
  now: number;
  busy: boolean;
  anyBusy: boolean;
  onDecline: () => void;
  onApprove: () => void;
}) {
  const left = Math.max(0, Math.floor((new Date(c.expiresAt).getTime() - now) / 1000));
  const total = Math.max(1, Math.min(CHALLENGE_TTL_MS, new Date(c.expiresAt).getTime() - new Date(c.createdAt).getTime()) / 1000);
  const urgent = left <= 60;
  const risk = assessChallenge(c);
  const category = mccLabel(c.merchant.mcc);
  const location = [c.merchant.city, c.merchant.country].filter(Boolean).join(", ");

  return (
    <div className="glass-panel fade-up" style={{ marginBottom: 12, padding: 14 }}>
      {/* Merchant + amount */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="asset-logo" style={{ width: 38, height: 38, background: "var(--fp-bg-surface)", color: "var(--fp-accent)", fontSize: "0.95rem" }}>
          {c.merchant.name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{c.merchant.name}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
            {location || "Online purchase"}
            {category ? ` · ${category}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 800, fontSize: "1.05rem" }}>${usd(c.amountUsd)}</div>
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)" }}>{c.currency.toUpperCase()}</div>
        </div>
      </div>

      {/* Countdown */}
      <div style={{ margin: "10px 0" }}>
        <div className="countdown-track">
          <div className={`countdown-fill${urgent ? " urgent" : ""}`} style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", color: urgent ? "var(--fp-loss)" : "var(--fp-text-muted)", marginTop: 4 }}>
          <span>
            Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
          <span>Card ····{c.cardId.slice(-4)}</span>
        </div>
      </div>

      {/* FurlPay Protect verdict */}
      <div className={`risk risk--${risk.level}`} style={{ marginBottom: 8 }}>
        <Icon name={risk.level === "safe" ? "approve" : "security"} size={15} />
        <div>
          <div style={{ fontWeight: 700 }}>{risk.label} · FurlPay Protect</div>
          <div style={{ opacity: 0.85 }}>{risk.reason}</div>
        </div>
      </div>

      {/* Outcome simulation */}
      <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        <span style={{ color: "var(--fp-accent)" }}>If approved:</span> ${usd(c.amountUsd)} charged to card ····{c.cardId.slice(-4)}.{" "}
        <span style={{ color: "var(--fp-text-secondary)" }}>If declined:</span> nothing is charged — declining is always free.
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" style={{ flex: 1 }} disabled={anyBusy} onClick={onDecline}>
          {busy ? "Declining…" : "Decline"}
        </button>
        <button className="btn-primary" style={{ flex: 1.4 }} onClick={onApprove}>
          Approve with biometric
        </button>
      </div>
    </div>
  );
}
