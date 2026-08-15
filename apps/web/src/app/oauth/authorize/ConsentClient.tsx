"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

// The consent UI. Every scope is spelled out in plain language, and the
// money-moving one is called out explicitly — a user who cannot tell what they
// are granting has not consented to anything.
//
// The page never sees a token: it POSTs to /api/oauth/authorize with the
// session cookie, and the server mints the code and tells us where to go.

const SCOPE_COPY: Record<string, { label: string; detail: string; sensitive?: boolean }> = {
  "profile:read": { label: "Your profile", detail: "Name, email and account status." },
  "wallets:read": { label: "Balances", detail: "Stablecoin balances across your chains." },
  "transactions:read": { label: "Transaction history", detail: "Past payments, cards and spending." },
  "travel:read": { label: "Travel", detail: "Your trips and available stays." },
  "investing:read": { label: "Portfolio", detail: "Holdings, performance and dividend entitlements. Read-only — no trading." },
  "payments:write": {
    label: "Prepare payments",
    detail: "Draft payments and invoices for you to approve. Cannot send money on its own.",
    sensitive: true,
  },
  "travel:write": {
    label: "Prepare bookings",
    detail: "Draft travel bookings for you to approve. Cannot book or charge on its own.",
    sensitive: true,
  },
};

export default function ConsentClient() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "";
  const scope = params.get("scope") ?? "";
  const state = params.get("state") ?? "";

  const scopes = (scope ? scope.split(/[\s+]+/) : []).filter((s) => SCOPE_COPY[s]);
  const malformed = !clientId || !redirectUri || !codeChallenge || method !== "S256";

  const decide = async (allow: boolean) => {
    if (!allow) {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          ...(scope ? { scope } : {}),
          ...(state ? { state } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return;
        }
        throw new Error(data?.error ?? "Could not complete the connection.");
      }
      window.location.href = data.redirectTo;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (malformed) {
    return (
      <main style={styles.wrap}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Invalid connection request</h1>
          <p style={styles.dim}>
            This link is missing required security parameters (PKCE). Start the connection again from your AI client.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>
          Connect <span style={{ color: "#E7FF52" }}>FurlPay</span>
        </h1>
        <p style={styles.dim}>
          An AI client wants to connect to your FurlPay account. It will be able to:
        </p>

        <ul style={styles.list}>
          {scopes.map((s) => (
            <li key={s} style={styles.item}>
              <div style={{ fontWeight: 600, color: SCOPE_COPY[s].sensitive ? "#E7FF52" : "#fff" }}>
                {SCOPE_COPY[s].label}
              </div>
              <div style={styles.dim}>{SCOPE_COPY[s].detail}</div>
            </li>
          ))}
        </ul>

        <p style={styles.notice}>
          FurlPay never lets an AI move your money on its own. Payments and bookings are prepared for you and
          require your approval with a passkey.
        </p>

        {error ? <p style={{ color: "#FF6B6B" }}>{error}</p> : null}

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button onClick={() => void decide(true)} disabled={busy} style={styles.primary}>
            {busy ? "Connecting…" : "Allow"}
          </button>
          <button onClick={() => void decide(false)} disabled={busy} style={styles.secondary}>
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#000",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "#0D0F12",
    border: "1px solid #22262B",
    borderRadius: 16,
    padding: 28,
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  h1: { fontSize: 24, fontWeight: 800, margin: 0 },
  dim: { color: "#9AA0A6", fontSize: 14, margin: 0, lineHeight: 1.5 },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 },
  item: { background: "#15181C", borderRadius: 10, padding: "10px 12px" },
  notice: {
    background: "#15181C",
    borderLeft: "3px solid #E7FF52",
    padding: "10px 12px",
    borderRadius: 6,
    color: "#C9CDD2",
    fontSize: 13,
    margin: 0,
    lineHeight: 1.5,
  },
  primary: {
    flex: 1,
    background: "#E7FF52",
    color: "#000",
    border: "none",
    borderRadius: 999,
    padding: "12px 18px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondary: {
    flex: 1,
    background: "transparent",
    color: "#fff",
    border: "1px solid #2A2F36",
    borderRadius: 999,
    padding: "12px 18px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
