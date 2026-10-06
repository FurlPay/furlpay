"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OnchainDashboard } from "@/lib/onchain/dashboard";
import type { LiveState } from "@/components/analytics/useDashboard";

export type OnchainRange = "24h" | "7d" | "30d" | "90d";
export const ONCHAIN_POLL_MS = 30_000;

function unavailable(d: OnchainDashboard): number {
  return [d.ledger, d.risk, d.market].filter((s) => s.status !== "ok").length;
}

/**
 * Polls GET /api/ops/onchain every 30s (paused while the tab is hidden).
 * Keeps the last good payload on a failed poll and reports Offline with its
 * age instead of blanking the page — the same contract as useDashboard.
 */
export function useOnchain(range: OnchainRange, chain: string) {
  const [data, setData] = useState<OnchainDashboard | null>(null);
  const [state, setState] = useState<LiveState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const url = `/api/ops/onchain?${new URLSearchParams({ range, chain }).toString()}`;

  const load = useCallback(async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { ok: true; data: OnchainDashboard } | { ok: false; error?: { message?: string } } | null;
      if (!res.ok || !body || !body.ok) {
        setError((body && !body.ok && body.error?.message) || `Request failed (${res.status})`);
        setState("offline");
        return;
      }
      setData(body.data);
      setError(null);
      setUpdatedAt(Date.now());
      setState(unavailable(body.data) > 0 ? "degraded" : "live");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("Network error — unable to reach the onchain API.");
      setState("offline");
    }
  }, [url]);

  useEffect(() => {
    void load();
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void load(), ONCHAIN_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") window.clearInterval(timer);
      else {
        void load();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      abort.current?.abort();
    };
  }, [load]);

  return { data, state, error, updatedAt, reload: load };
}
