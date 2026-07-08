"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { getJSON, sendJSON } from "@/lib/api";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { enableTransactionApprovals, pushPermissionState } from "@/lib/pushClient";

// 3DS2 out-of-band approval screen. Push notifications deep-link here
// (/cards/approve?challenge=chal_…); the user approves with the device
// biometric (passkey assertion) or declines. This is the "app popup" leg of
// the card-authorization challenge flow.

interface PendingChallenge {
  id: string;
  amountUsd: number;
  currency: string;
  merchant: { name: string; city?: string; country?: string; mcc?: string };
  cardId: string;
  createdAt: string;
  expiresAt: string;
}

function secondsLeft(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function ApproveInner() {
  const params = useSearchParams();
  const focusId = params.get("challenge");

  const [challenges, setChallenges] = useState<PendingChallenge[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // challenge id being decided
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<string>("");
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await getJSON<{ challenges: PendingChallenge[] }>("/api/cards/challenges");
      setChallenges(r.challenges);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending approvals");
      setChallenges([]);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000); // pushes can beat the poll; poll catches missed ones
    const tick = setInterval(() => forceTick((n) => n + 1), 1000); // countdown re-render
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    pushPermissionState().then((s) => setPushState(s));
  }, []);

  async function decide(challenge: PendingChallenge, decision: "approved" | "declined") {
    setBusy(challenge.id);
    setError(null);
    try {
      let assertion;
      if (decision === "approved") {
        // Biometric ceremony bound to this specific purchase.
        const optionsJSON = await sendJSON<any>("/api/cards/challenges/options", {
          challengeId: challenge.id,
        });
        assertion = await startAuthentication({ optionsJSON });
      }
      const r = await sendJSON<{ status: string }>("/api/cards/challenges/verify", {
        challengeId: challenge.id,
        decision,
        assertion,
      });
      setResults((m) => ({ ...m, [challenge.id]: r.status }));
      setChallenges((cs) => (cs ?? []).filter((c) => c.id !== challenge.id));
    } catch (e: any) {
      setError(e?.message ?? "Verification failed");
    } finally {
      setBusy(null);
    }
  }

  async function enablePush() {
    setPushState("…");
    setPushState(await enableTransactionApprovals());
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-24 pt-6">
      <PageHeader title="Transaction approvals" />
      <p className="mb-4 px-1 text-sm text-white/50">
        Approve card payments with your fingerprint or Face ID.
      </p>

      {pushState !== "granted" && pushState !== "enabled" && (
        <button
          onClick={enablePush}
          className="mb-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/10"
        >
          <span className="font-medium text-white">Enable approval notifications</span>
          <br />
          Get an instant popup on this device when a card payment needs your approval.
          {pushState === "denied" && (
            <span className="mt-1 block text-red-400">Notifications are blocked in browser settings.</span>
          )}
          {pushState === "unconfigured" && (
            <span className="mt-1 block text-amber-400">Push keys not configured on the server yet.</span>
          )}
        </button>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {Object.entries(results).map(([id, status]) => (
        <div
          key={id}
          className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
            status === "approved"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-white/70"
          }`}
        >
          {status === "approved" ? "Payment approved — the merchant will complete the charge." : "Payment declined. No fee charged — declines are always free on FurlPay."}
        </div>
      ))}

      {challenges === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : challenges.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-white/60">
          No payments waiting for approval.
        </div>
      ) : (
        challenges.map((c) => {
          const left = secondsLeft(c.expiresAt);
          const focused = c.id === focusId;
          return (
            <div
              key={c.id}
              className={`mb-4 rounded-2xl border bg-white/5 p-5 ${
                focused ? "border-red-500/50 ring-1 ring-red-500/30" : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{c.merchant.name}</div>
                  <div className="mt-0.5 text-xs text-white/50">
                    {[c.merchant.city, c.merchant.country].filter(Boolean).join(", ") || "Online purchase"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-white">{usd(c.amountUsd)}</div>
                  <Pill tone={left > 60 ? "muted" : "loss"}>
                    {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left` : "expired"}
                  </Pill>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  onClick={() => decide(c, "declined")}
                  disabled={busy !== null || left === 0}
                  className="rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  Decline
                </button>
                <button
                  onClick={() => decide(c, "approved")}
                  disabled={busy !== null || left === 0}
                  className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                >
                  {busy === c.id ? "Verifying…" : "Approve with biometric"}
                </button>
              </div>
            </div>
          );
        })
      )}
    </main>
  );
}

export default function ApprovePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <ApproveInner />
    </Suspense>
  );
}
