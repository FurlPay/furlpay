"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OnchainDashboard } from "@/lib/onchain/dashboard";
import type { LiveState } from "@/components/analytics/useDashboard";
export type OnchainRange = "24h" | "7d" | "30d" | "90d";
export const ONCHAIN_POLL_MS = 30_000;

/** Deduplicate requests, abort superseded filters, and pause hidden tabs. */
export function useOnchain(range: OnchainRange, chain: string, enabled = true) {
  const url = "/api/onchain?" + new URLSearchParams({ range, chain });
  const [result, setResult] = useState<{ url: string; data: OnchainDashboard; at: number } | null>(null);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const current = useRef(url);
  current.current = url;
  const mounted = useRef(false);
  const flight = useRef<{ url: string; ac: AbortController; promise: Promise<void> } | null>(null);
  const failures = useRef(0);
  const load = useCallback((): Promise<void> => {
    if (!enabled || !mounted.current || document.visibilityState === "hidden") return Promise.resolve();
    if (flight.current?.url === url) return flight.current.promise;
    flight.current?.ac.abort();
    const ac = new AbortController();
    const valid = () => mounted.current && !ac.signal.aborted && current.current === url;
    const promise = (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
        const b = await res.json().catch(() => null) as { ok?: boolean; data?: OnchainDashboard; error?: { message?: string } } | null;
        if (!valid()) return;
        if (!res.ok || !b?.ok || !b.data) throw new Error(b?.error?.message || "Request failed (" + res.status + ")");
        setResult({ url, data: b.data, at: Date.now() });
        setFailure(null);
        failures.current = 0;
      } catch (e) {
        if (!valid()) return;
        failures.current++;
        setFailure({ url, message: e instanceof Error ? e.message : "Onchain API unavailable." });
      } finally {
        if (flight.current?.ac === ac) flight.current = null;
      }
    })();
    flight.current = { url, ac, promise };
    return promise;
  }, [url, enabled]);
  useEffect(() => {
    mounted.current = true;
    failures.current = 0;
    let timer: number | undefined;
    let active = true;
    let ticking = false;
    const tick = async () => {
      if (ticking) return;
      ticking = true;
      await load();
      ticking = false;
      if (active && enabled && document.visibilityState !== "hidden") {
        timer = window.setTimeout(() => void tick(), Math.min(120_000, ONCHAIN_POLL_MS * 2 ** failures.current));
      }
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") { flight.current?.ac.abort(); flight.current = null; }
      else void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      mounted.current = false;
      window.clearTimeout(timer);
      flight.current?.ac.abort();
      flight.current = null;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load, enabled]);
  const data = result?.url === url ? result.data : null;
  const error = failure?.url === url ? failure.message : null;
  const state: LiveState = error ? "offline" : !data ? "connecting" : [data.ledger, data.risk, data.market].some(s => s.status !== "ok") ? "degraded" : "live";
  return { data, error, state, updatedAt: result?.url === url ? result.at : null, reload: load };
}
