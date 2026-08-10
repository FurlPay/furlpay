"use client";

/*
 * FurlPay Wallet — authorization / consent step.
 *
 * Mirrors the reference OAuth consent UX, but entirely first-party: the
 * "FurlPay Wallet" client asks the signed-in user to grant read access to their
 * FurlPay account, and on Authorize the reserved handle is atomically bound to
 * that account (POST /api/wallet/authorize).
 *
 * Gating follows the app's established consent pattern: the page fetches the
 * current profile; a 401 routes the user to /login and back. The Authorize
 * action carries only the session cookie — the page never handles a token.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const HANDLE_PATTERN = /^[a-z0-9-]+$/;

// Plain-language copy for each granted read scope. Order matches the grant.
const PERMISSIONS: { scope: string; label: string; detail: string }[] = [
  { scope: "profile:read", label: "Profile & account details", detail: "Your name, email and account status." },
  { scope: "wallets:read", label: "Balances", detail: "Stablecoin balances across your chains." },
  { scope: "transactions:read", label: "Transaction history", detail: "Your past payments and spending." },
];

function FurlIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand icon in public/, sized by CSS
    <img src="/wallet/mark.png" alt="FurlPay" aria-hidden="true" className="furl-icon" />
  );
}

interface Profile {
  email?: string;
  name?: string;
}

export default function WalletConsent() {
  const router = useRouter();
  const params = useSearchParams();
  const rawHandle = (params.get("handle") ?? "").trim().toLowerCase();
  const validHandle = rawHandle.length >= 3 && rawHandle.length <= 32 && HANDLE_PATTERN.test(rawHandle);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginRedirect = useCallback(() => {
    const next = `/wallet/authorize?handle=${encodeURIComponent(rawHandle)}`;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  }, [rawHandle]);

  // Establish the session + show who is signed in. 401 → sign in, then return.
  useEffect(() => {
    if (!validHandle) {
      setPhase("error");
      setError("This authorization link is missing a valid wallet name.");
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/profile", { headers: { accept: "application/json" } });
        if (!live) return;
        if (res.status === 401) {
          loginRedirect();
          return;
        }
        if (!res.ok) throw new Error();
        const data = (await res.json()) as Profile;
        setProfile({ email: data.email, name: data.name });
        setPhase("ready");
      } catch {
        if (live) {
          setPhase("error");
          setError("Could not load your account. Please try again.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [validHandle, loginRedirect]);

  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: rawHandle }),
      });
      if (res.status === 401) {
        loginRedirect();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; handle?: string; error?: string };
      if (res.ok && data.ok && data.handle) {
        router.push(`/wallet?reserved=${encodeURIComponent(data.handle)}`);
        return;
      }
      setError(data.error || "Could not authorize. Please try again.");
      setBusy(false);
    } catch {
      setError("Could not authorize. Please try again.");
      setBusy(false);
    }
  }

  if (phase === "error") {
    return (
      <main className="launch-page consent-page">
        <div className="consent-card">
          <h1 className="consent-title">Something went wrong</h1>
          <p className="consent-dim">{error}</p>
          <Link className="claim-button" href="/wallet" style={{ textDecoration: "none" }}>
            Back to reservation
          </Link>
        </div>
      </main>
    );
  }

  if (phase === "loading" || !profile) {
    return (
      <main className="launch-page consent-page">
        <div className="consent-card">
          <span className="status-spinner" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
          <p className="consent-dim">Loading your account…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="launch-page consent-page">
      <div className="consent-card">
        <div className="consent-head">
          <FurlIcon />
          <div>
            <h1 className="consent-title">FurlPay Wallet wants to access your account</h1>
            <p className="consent-dim">This application is owned and managed by FurlPay.</p>
          </div>
        </div>

        <div className="consent-scopes-head">
          <span>Account access</span>
          <span className="consent-count">{PERMISSIONS.length} permissions</span>
        </div>

        <ul className="consent-list">
          {PERMISSIONS.map((p) => (
            <li key={p.scope} className="consent-item">
              <span className="consent-check" aria-hidden="true">
                ✓
              </span>
              <div>
                <div className="consent-item-label">{p.label}</div>
                <div className="consent-dim">{p.detail}</div>
              </div>
              <span className="consent-badge">Read</span>
            </li>
          ))}
        </ul>

        <div className="consent-account">
          <span className="consent-account-avatar" aria-hidden="true">
            {(profile.name || profile.email || "?").charAt(0).toUpperCase()}
          </span>
          <div>
            <div className="consent-item-label">Reserving @{rawHandle} for</div>
            <div className="consent-dim">{profile.email || profile.name || "your FurlPay account"}</div>
          </div>
        </div>

        <p className="consent-notice">Only authorize access if you trust this application.</p>

        {error ? <p className="consent-error">{error}</p> : null}

        <div className="consent-actions">
          <button className="claim-button" onClick={() => void authorize()} disabled={busy} type="button">
            {busy ? "Authorizing…" : "Authorize"}
          </button>
          <button
            className="consent-cancel"
            onClick={() => router.push("/wallet")}
            disabled={busy}
            type="button"
          >
            Cancel
          </button>
        </div>

        <p className="consent-fineprint">
          FurlPay Wallet gets read-only access. It can never move your money. You can revoke this anytime in
          Profile → Connected applications.
        </p>
      </div>
    </main>
  );
}
