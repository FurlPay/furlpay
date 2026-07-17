import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import type { Entitlements, PasskeyList } from "@/lib/types";
import {
  SessionState,
  SettingsTile,
  StoredToggle,
  deviceLabel,
  openSite,
  relTime,
  send,
} from "./shared";

export default function SettingsTab({ session, onSignedOut }: { session: SessionState; onSignedOut: () => void }) {
  const [showPasskeys, setShowPasskeys] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div style={{ padding: "0 14px" }}>
      {/* Profile */}
      <div className="glass-panel fade-up" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: 14 }}>
        <span className="qa-icon" style={{ width: 42, height: 42, borderRadius: "50%" }}>
          <Icon name="user" size={19} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{session.name ?? "FurlPay user"}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
            <span className="status-dot status-dot--on" style={{ width: 5, height: 5 }} />
            Signed in · {deviceLabel()} · this device
          </div>
        </div>
        <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: "0.74rem" }} onClick={() => openSite("/profile")}>
          Edit
        </button>
      </div>

      {/* Plan */}
      <h3 className="section-title">Plan</h3>
      <PlanPanel />

      {/* Security */}
      <h3 className="section-title">Security</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <SettingsTile icon="passkey" label="Passkeys" sub="Manage devices that control your account" onClick={() => setShowPasskeys((s) => !s)} chevron={!showPasskeys} />
        {showPasskeys && <PasskeysPanel />}
        <SettingsTile icon="approve" label="Approvals" sub="Biometric 3DS2 — approvals sign on furlpay.com" onClick={() => openSite("/cards/approve")} chevron />
        <SettingsTile icon="security" label="Security center" sub="2FA, sessions, trusted devices" onClick={() => openSite("/profile#security")} chevron />
      </div>

      {/* Notifications — why they matter + a real test (G12) */}
      <h3 className="section-title">Notifications</h3>
      <NotificationsPanel />

      {/* Preferences */}
      <h3 className="section-title">Preferences</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <StoredToggle icon="bell" storageKey="prefSecurityAlerts" label="Security alerts" sub="Notify on pending card approvals" defaultOn />
        <StoredToggle icon="invest" storageKey="prefPriceAlerts" label="Price alerts" sub="Notify on large balance moves" />
        <SettingsTile icon="globe" label="Currency & language" sub="USD · English" onClick={() => openSite("/profile")} chevron />
      </div>

      {/* Developer */}
      <h3 className="section-title">Developer</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <SettingsTile icon="code" label="x402 inspector" sub="DevTools → FurlPay x402" onClick={() => setShowDeveloper((s) => !s)} chevron={!showDeveloper} />
        {showDeveloper && <DeveloperPanel />}
      </div>

      {/* Support */}
      <h3 className="section-title">Support & legal</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 14 }}>
        <SettingsTile icon="help" label="Help center" sub="furlpay.com/support" onClick={() => openSite("/contact")} chevron />
        <SettingsTile icon="history" label="About FurlPay" sub={`v${browser.runtime.getManifest().version} (MV3) · Terms & privacy`} onClick={() => openSite("/legal/terms")} chevron />
      </div>

      <button
        className="btn-danger"
        style={{ width: "100%", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await send({ type: "LOGOUT" });
          onSignedOut();
        }}
      >
        <Icon name="logout" size={15} /> {signingOut ? "Signing out…" : "Sign out"}
      </button>

      <div className="trust-strip">
        {[
          { icon: "passkey" as const, text: "Passkey security" },
          { icon: "security" as const, text: "No keys stored in browser" },
          { icon: "check" as const, text: "On-chain verified" },
          { icon: "approve" as const, text: "TLS 1.3 encrypted" },
        ].map((t) => (
          <span key={t.text}>
            <Icon name={t.icon} size={12} /> {t.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Notifications ------------------------------------------------------------
//
// The extension holds the `notifications` permission for exactly one critical
// job: 3-D Secure approval alerts. A user who muted Chrome notifications at
// the OS level would silently miss card approvals — so explain the stakes and
// let them fire a test to SEE whether delivery works on this machine.

function NotificationsPanel() {
  const [tested, setTested] = useState<"idle" | "sent" | "failed">("idle");

  const sendTest = useCallback(async () => {
    try {
      await browser.notifications.create("furlpay-test", {
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon128.png"),
        title: "FurlPay notifications work",
        message: "This is how a card-approval alert will look.",
      });
      setTested("sent");
    } catch {
      setTested("failed");
    }
    setTimeout(() => setTested("idle"), 4000);
  }, []);

  return (
    <div className="glass-panel" style={{ padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <span style={{ color: "var(--fp-accent)", display: "flex", marginTop: 1 }}>
          <Icon name="bell" size={16} />
        </span>
        <span style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", lineHeight: 1.5 }}>
          Card approvals arrive as system notifications. If your browser or OS mutes them, a
          3-D Secure request can expire unseen — send a test to make sure delivery works.
        </span>
      </div>
      <button className="btn-ghost" style={{ width: "100%", padding: "8px" }} onClick={sendTest}>
        {tested === "sent" ? "Sent — did you see it?" : tested === "failed" ? "Couldn't send — check browser settings" : "Send test notification"}
      </button>
    </div>
  );
}

// --- Plan / entitlements -------------------------------------------------------
//
// Chrome Web Store has no billing rails, so upgrades run through Stripe
// Checkout on furlpay.com (sandbox mode upgrades instantly in dev). The
// feature map comes from /api/user/entitlements — the same source the site
// uses, so gating never drifts between surfaces.

const FEATURE_LABELS: Record<string, string> = {
  unlimited_x402: "Unlimited x402 payments",
  ai_travel_sidebar: "AI travel agent sidebar",
  fee_scanner: "Merchant fee scanner",
  cashback_tracker: "Cashback tracker",
  x402_inspector: "x402 DevTools inspector",
  api_keys: "API key management",
};

function PlanPanel() {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    send<Entitlements>({ type: "GET_ENTITLEMENTS" }).then((r) =>
      r.ok ? setEnt(r.data) : setError(r.error)
    );
  }, []);
  useEffect(load, [load]);

  if (error)
    return (
      <div className="glass-panel" style={{ marginBottom: 12, padding: 12, fontSize: "0.76rem", color: "var(--fp-text-muted)" }}>
        Plan info unavailable: {error}
      </div>
    );
  if (!ent) return <div className="skeleton" style={{ height: 60, borderRadius: 16, marginBottom: 12 }} />;

  const upgrade = async (plan: "pro" | "developer") => {
    setBusy(plan);
    await send({ type: "UPGRADE_PLAN", plan });
    setBusy(null);
    load();
  };

  return (
    <div className="glass-panel" style={{ marginBottom: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>
          {ent.tier === "Standard" ? "Free plan" : `${ent.tier} plan`}
        </span>
        {ent.tier === "Standard" ? (
          <span className="pill">Free</span>
        ) : (
          <span className="pill pill--accent">
            <span className="status-dot status-dot--on" style={{ width: 5, height: 5 }} /> Active
          </span>
        )}
      </div>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => {
        const on = ent.features[key];
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: "0.76rem", color: on ? "var(--fp-text-secondary)" : "var(--fp-text-muted)" }}>
            <span style={{ color: on ? "var(--fp-accent)" : "var(--fp-text-muted)", display: "flex" }}>
              <Icon name={on ? "check" : "security"} size={13} />
            </span>
            {label}
            {!on && <span className="pill" style={{ marginLeft: "auto", fontSize: "0.6rem" }}>{key === "x402_inspector" || key === "api_keys" ? "Developer" : "Pro"}</span>}
          </div>
        );
      })}
      {ent.tier !== "Ultra" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {ent.tier === "Standard" && (
            <button className="btn-primary" style={{ flex: 1, padding: "8px" }} disabled={busy !== null} onClick={() => upgrade("pro")}>
              {busy === "pro" ? "Opening…" : "Upgrade to Pro"}
            </button>
          )}
          <button className="btn-ghost" style={{ flex: 1, padding: "8px" }} disabled={busy !== null} onClick={() => upgrade("developer")}>
            {busy === "developer" ? "Opening…" : "Developer plan"}
          </button>
        </div>
      )}
    </div>
  );
}

function DeveloperPanel() {
  const [baseUrl, setBase] = useState("");
  const [saved, setSaved] = useState(false);
  const [x402Count, setX402Count] = useState(0);

  useEffect(() => {
    import("@/lib/api").then(({ getBaseUrl }) => getBaseUrl().then(setBase));
    browser.storage.local.get("x402Log").then(({ x402Log }) => {
      if (Array.isArray(x402Log)) setX402Count(x402Log.length);
    });
  }, []);

  return (
    <div style={{ padding: "4px 12px 10px" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 8 }}>
        {x402Count} x402 payment-required responses captured. Open DevTools → FurlPay x402 for the inspector.
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--fp-text-secondary)", display: "block", marginBottom: 4 }}>Backend URL</label>
      <input className="input" value={baseUrl} onChange={(e) => setBase(e.target.value)} spellCheck={false} aria-label="Backend URL" />
      <button
        className="btn-ghost"
        style={{ marginTop: 8, width: "100%", padding: "8px" }}
        onClick={async () => {
          const { setBaseUrl } = await import("@/lib/api");
          await setBaseUrl(baseUrl);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

// --- Passkey wallet manager --------------------------------------------------------
//
// Lists the WebAuthn credentials bound to the user's smart account. Adding a
// passkey deep-links to furlpay.com — registration must run on the rpID origin,
// never from a chrome-extension:// page. Revoking is a plain API call; the
// server refuses to remove the last remaining credential.

function PasskeysPanel() {
  const [list, setList] = useState<PasskeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    send<PasskeyList>({ type: "GET_PASSKEYS" }).then((r) => {
      if (r.ok) {
        setList(r.data);
        setError(null);
      } else setError(r.error);
    });
  }, []);
  useEffect(load, [load]);

  const addr = list?.safeAddress;

  return (
    <div style={{ padding: "0 12px 10px" }}>
      {addr && (
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 8 }}>
          Smart account{" "}
          <span style={{ fontFamily: "var(--fp-font-mono)", color: "var(--fp-text-secondary)" }}>
            {addr.slice(0, 6)}…{addr.slice(-4)}
          </span>{" "}
          — controlled by the devices below.
        </div>
      )}
      {error && <div style={{ color: "var(--fp-loss)", fontSize: "0.75rem", marginBottom: 8 }}>{error}</div>}
      {!list && !error && <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 8 }} />}
      {list?.credentials.length === 0 && (
        <div style={{ fontSize: "0.76rem", color: "var(--fp-text-secondary)", marginBottom: 8 }}>
          No passkeys registered in this sandbox session yet.
        </div>
      )}
      {list?.credentials.map((pk) => (
        <div key={pk.id} className="tx-row" style={{ padding: "8px 0" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.82rem" }}>{pk.name}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>
              Added {relTime(pk.createdAt)} · used {relTime(pk.lastUsedAt)}
            </div>
          </div>
          <button
            className="btn-ghost"
            style={{ padding: "4px 10px", fontSize: "0.7rem" }}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(pk.id);
              const r = await send({ type: "REVOKE_PASSKEY", credentialId: pk.id });
              if (!r.ok) setError(r.error);
              setBusy(null);
              load();
            }}
          >
            {busy === pk.id ? "Removing…" : "Remove"}
          </button>
        </div>
      ))}
      <button className="btn-primary" style={{ width: "100%", marginTop: 8, padding: "9px" }} onClick={() => openSite("/profile#security")}>
        Add passkey on this device
      </button>
    </div>
  );
}
