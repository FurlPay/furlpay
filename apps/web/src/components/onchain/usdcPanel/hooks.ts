"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UsdcNetwork, UsdcWindow } from "@/lib/onchain/usdcNetwork";
import type { HistoryRange, UsdcHistory } from "@/lib/onchain/usdcHistory";

// Polling hooks for the USDC section. Each widget loads and fails on its own:
// the last good data stays on screen with its age; a newer request always
// wins over an older one (sequence numbers), and polling pauses while the tab
// is hidden.

function usePolled<T>(url: string, everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const b = (await res.json().catch(() => null)) as { ok: true; data: T } | { ok: false; error?: { message?: string } } | null;
      if (my !== seq.current) return;
      if (b && b.ok) {
        setData(b.data);
        setError(null);
        setLastOk(Date.now());
      } else setError((b && !b.ok && b.error?.message) || `Request failed (${res.status})`);
    } catch {
      if (my === seq.current) setError("Network error.");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    setData(null);
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), everyMs);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, everyMs]);
  return { data, error, lastOk, loading, reload: load };
}

export const useUsdcLive = (win: UsdcWindow) => usePolled<UsdcNetwork>(`/api/onchain/usdc?window=${win}`, 10_000);
export const useUsdcHistory = (range: HistoryRange) => usePolled<UsdcHistory>(`/api/onchain/usdc/history?range=${range}`, range === "1h" ? 30_000 : 60_000);

/** Re-renders every `ms` so "12s ago" labels stay true between fetches. */
export function useTick(ms = 5_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
