import { Icon, LogoMark } from "@/components/icons";
import { openSite, send } from "./shared";

export default function SignedOut() {
  return (
    <div style={{ padding: "26px 20px", textAlign: "center" }} className="fade-up">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <LogoMark size={54} />
      </div>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 4 }}>
        Welcome back
      </div>
      <p style={{ fontSize: "0.82rem", color: "var(--fp-text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
        Sign in securely with your passkey on FurlPay. The extension picks up your session
        automatically.
      </p>

      <div className="glass-panel" style={{ textAlign: "left", padding: "12px 14px", marginBottom: 18 }}>
        {[
          { icon: "passkey" as const, text: "Passwordless — passkeys only" },
          { icon: "security" as const, text: "No keys or tokens stored in the browser" },
          { icon: "approve" as const, text: "Session synced automatically" },
        ].map((f) => (
          <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <span style={{ color: "var(--fp-accent)", display: "flex" }}>
              <Icon name={f.icon} size={16} />
            </span>
            <span style={{ fontSize: "0.79rem", color: "var(--fp-text-secondary)" }}>{f.text}</span>
          </div>
        ))}
      </div>

      <button className="btn-primary" style={{ width: "100%" }} onClick={() => send({ type: "OPEN_LOGIN" })}>
        Open FurlPay
      </button>
      <button
        className="list-tile"
        style={{ justifyContent: "center", marginTop: 8, color: "var(--fp-text-muted)", fontSize: "0.75rem" }}
        onClick={() => openSite("/contact")}
      >
        Need help?
      </button>
    </div>
  );
}
