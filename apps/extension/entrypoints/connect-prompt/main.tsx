import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { LogoMark } from "@/components/icons";
import "@/assets/global.css";

// Dapp connection consent prompt. Opened by the background worker when a page
// requests eth_requestAccounts from an origin the user has not yet approved.
// The verdict goes back via WALLET_CONNECT_DECISION; closing the window
// without answering counts as Deny (windows.onRemoved in background.ts).
//
// Only the ORIGIN is trusted here — it was resolved by the background from
// the message sender, never from page-supplied data.

function ConnectPrompt() {
  const { rid, origin } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { rid: params.get("rid") ?? "", origin: params.get("origin") ?? "" };
  }, []);
  const [busy, setBusy] = useState(false);

  const host = useMemo(() => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  }, [origin]);

  async function decide(allow: boolean) {
    setBusy(true);
    try {
      await browser.runtime.sendMessage({ type: "WALLET_CONNECT_DECISION", requestId: rid, allow });
    } finally {
      window.close();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        padding: "28px 22px 22px",
        boxSizing: "border-box",
        textAlign: "center",
        fontFamily: "var(--fp-font-sans)",
      }}
    >
      <LogoMark size={44} />
      <h1 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "18px 0 6px" }}>
        Connect to this site?
      </h1>
      <div
        style={{
          fontFamily: "var(--fp-font-mono)",
          fontSize: "0.85rem",
          color: "var(--fp-accent)",
          background: "var(--fp-accent-soft)",
          border: "1px solid var(--fp-border-glass)",
          borderRadius: 10,
          padding: "8px 14px",
          margin: "6px 0 14px",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={origin}
      >
        {host}
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--fp-text-secondary)", lineHeight: 1.55, margin: 0 }}>
        This site wants to see your FurlPay smart-account <strong>address</strong>. It cannot move
        funds or sign anything — transactions are always approved with your passkey on furlpay.com.
      </p>
      <p style={{ fontSize: "0.72rem", color: "var(--fp-text-muted)", lineHeight: 1.5, margin: "10px 0 0" }}>
        Only connect to sites you trust: your address lets a site see your on-chain balances and
        history.
      </p>

      <div style={{ marginTop: "auto", display: "flex", gap: 10, width: "100%", paddingTop: 20 }}>
        <button className="btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => decide(false)}>
          Deny
        </button>
        <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => decide(true)}>
          Connect
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectPrompt />
  </React.StrictMode>
);
