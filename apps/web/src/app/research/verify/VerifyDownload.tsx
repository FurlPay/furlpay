"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Reads the single-use token from the URL fragment (#t=...), posts it once,
// and offers the download. The fragment is removed from the address bar
// immediately, so the token does not linger in history or get copied along.

type State =
  | { kind: "verifying" }
  | { kind: "ready"; title: string; downloadUrl: string; expiresAt: string }
  | { kind: "error"; heading: string; detail: string };

export default function VerifyDownload() {
  const [state, setState] = useState<State>({ kind: "verifying" });
  // React Strict Mode runs effects twice in development; a single-use token
  // must be posted exactly once.
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setState({ kind: "error", heading: "Link incomplete", detail: "Open the full link from your email, or request the report again." });
      return;
    }
    fetch("/api/research/download-verifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.downloadUrl) {
          setState({ kind: "ready", title: body.title, downloadUrl: body.downloadUrl, expiresAt: body.expiresAt });
        } else if (res.status === 410) {
          setState({ kind: "error", heading: "Link already used", detail: body.detail ?? "Request the report again for a new link." });
        } else if (res.status === 429) {
          setState({ kind: "error", heading: "Too many attempts", detail: "Wait a minute and open the link again." });
        } else if (res.status === 503) {
          setState({ kind: "error", heading: "Temporarily unavailable", detail: body.detail ?? "Please try the link again shortly." });
        } else {
          setState({ kind: "error", heading: "Link invalid or expired", detail: body.detail ?? "Request the report again for a new link." });
        }
      })
      .catch(() => setState({ kind: "error", heading: "Connection problem", detail: "Check your connection and open the link again." }));
  }, []);

  if (state.kind === "verifying") {
    return (
      <div role="status" aria-live="polite" className="mt-4">
        <h1 className="text-[24px] font-bold tracking-tight">Confirming your email…</h1>
        <div className="mt-4 h-2 w-40 animate-pulse rounded-full bg-white/10" aria-hidden />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="mt-4">
        <h1 className="text-[24px] font-bold tracking-tight">{state.heading}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-textSecondary">{state.detail}</p>
        <Link href="/research" className="mt-6 inline-block text-[14px] text-neon underline-offset-4 hover:underline">
          Back to FurlPay Research
        </Link>
      </div>
    );
  }
  return (
    <div role="status" className="mt-4">
      <h1 className="text-[24px] font-bold tracking-tight">Your download is ready</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-textSecondary">{state.title}</p>
      <a href={state.downloadUrl} className="btn-green mt-6 inline-block px-6 py-2.5 text-[14px]" rel="noreferrer">
        Download PDF
      </a>
      <p className="mt-4 text-[12px] text-textMuted">
        This link expires at {new Date(state.expiresAt).toLocaleTimeString()}. Please don’t share it — request your own copy instead.
      </p>
    </div>
  );
}
