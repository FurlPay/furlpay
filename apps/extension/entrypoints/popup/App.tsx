import { useCallback, useEffect, useState } from "react";
import { Icon, IconName, LogoMark, Wordmark } from "@/components/icons";
import type { PendingChallenge } from "@/lib/types";
import ActivityTab from "./components/ActivityTab";
import ApprovalsTab from "./components/ApprovalsTab";
import EarnTab from "./components/EarnTab";
import NotificationCenter from "./components/NotificationCenter";
import { Onboarding, useOnboarding } from "./components/Onboarding";
import SettingsTab from "./components/SettingsTab";
import SignedOut from "./components/SignedOut";
import WalletTab from "./components/WalletTab";
import { SessionState, SkeletonPage, Tab, openSite, send } from "./components/shared";

// FurlPay popup — the daily surface of the On-Chain Financial OS.
// Wallet / Activity / Approve / Earn / Settings. All data flows through the
// background worker (session-cookie API); the popup never talks to the network
// directly. This file is the root shell only — every surface lives in
// ./components (the former 1,600-line monolith, G1).

export default function App() {
  const [tab, setTab] = useState<Tab>("wallet");
  const [session, setSession] = useState<SessionState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const { shouldShow: showOnboarding, dismiss: dismissOnboarding } = useOnboarding();

  const loadSession = useCallback(() => {
    send<SessionState>({ type: "GET_SESSION_STATE" }).then((r) =>
      setSession(r.ok ? r.data : { authenticated: false, baseUrl: "https://furlpay.com" })
    );
  }, []);

  useEffect(() => {
    loadSession();
    // Instant badge from the background's cached challenges, then live.
    browser.storage.session
      .get("cachedChallenges")
      .then((v) => {
        const cached = v.cachedChallenges as PendingChallenge[] | undefined;
        if (cached) setPendingCount(cached.length);
      })
      .catch(() => {});
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then(
      (r) => r.ok && setPendingCount(r.data.challenges.length)
    );
  }, [loadSession]);

  const tabs: { id: Tab; label: string; icon: IconName; badge?: number }[] = [
    { id: "wallet", label: "Wallet", icon: "wallet" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "approvals", label: "Approve", icon: "approve", badge: pendingCount },
    { id: "earn", label: "Earn", icon: "earn" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const connected = session?.authenticated ?? false;

  if (showOnboarding) return <Onboarding onDone={dismissOnboarding} />;

  return (
    <div style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 560 }}>
      <div className="glow-orb glow-orb--green" />
      <div className="glow-orb glow-orb--purple" />

      <header style={{ padding: "14px 14px 10px", position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 8 }}>
        <LogoMark size={26} />
        <Wordmark />
        {connected && (
          <span
            className="pill pill--accent"
            style={{ marginLeft: "auto" }}
            title="Approvals sign with your passkey on furlpay.com — nothing stored in the browser"
          >
            <Icon name="passkey" size={11} /> Passkey
          </span>
        )}
        <span className="pill" style={{ marginLeft: connected ? 0 : "auto" }}>
          <span className={`status-dot ${connected ? "status-dot--on" : "status-dot--off"}`} />
          {session === null ? "Connecting" : connected ? "Arbitrum One" : "Not connected"}
        </span>
        {connected && (
          <button className="icon-btn" aria-label="Notifications" onClick={() => setBellOpen((o) => !o)}>
            <Icon name="bell" size={17} />
            {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
        )}
      </header>

      {bellOpen && connected && (
        <NotificationCenter
          onClose={() => setBellOpen(false)}
          onGoApprove={() => {
            setBellOpen(false);
            setTab("approvals");
          }}
        />
      )}

      <div style={{ flex: 1, position: "relative", zIndex: 1, paddingBottom: 4 }} role="tabpanel">
        {session === null ? (
          <SkeletonPage label="Checking your session…" />
        ) : !connected ? (
          <SignedOut />
        ) : (
          <>
            {tab === "wallet" && <WalletTab name={session.name} onQuickAction={openSite} />}
            {tab === "activity" && <ActivityTab />}
            {tab === "approvals" && <ApprovalsTab onCount={setPendingCount} />}
            {tab === "earn" && <EarnTab />}
            {tab === "settings" && <SettingsTab session={session} onSignedOut={loadSession} />}
          </>
        )}
      </div>

      <nav role="tablist" aria-label="FurlPay sections" style={{ display: "flex", justifyContent: "space-around", padding: "9px 0 10px", borderTop: "1px solid var(--fp-border-glass)", position: "relative", zIndex: 2, background: "var(--fp-bg-primary)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-label={t.label}
            aria-selected={tab === t.id}
            className="tab-btn"
            style={{ color: tab === t.id ? "var(--fp-accent)" : "var(--fp-text-muted)" }}
          >
            <Icon name={t.icon} />
            <span style={{ fontSize: "0.62rem", fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
            {t.badge ? <span className="nav-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
