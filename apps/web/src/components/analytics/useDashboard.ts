"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dashboard } from "@/lib/analytics/dashboard";

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "custom";
export type LiveState = "connecting" | "live" | "degraded" | "offline";

export interface DashboardQuery {
  range: RangeKey;
  from?: string;
  to?: string;
  product: string;
}

export const POLL_MS = 15_000;

/** Sections that report their source as unavailable, for the Degraded state. */
function unavailableCount(d: Dashboard): number {
  const sections = [
    ...Object.values(d.kpis),
    d.growth,
    d.funnel,
    d.transactions,
    d.alerts,
    d.feed,
    d.observability.requests,
  ];
  return sections.filter((s) => s.status !== "ok").length;
}

/**
 * Polls GET /api/ops/analytics/dashboard every 15s: ONE request per tick for
 * every panel. Pauses while the tab is hidden, aborts an in-flight request on
 * change/unmount, and keeps the last good data on a failed poll (shown with
 * the Offline state and its age) instead of blanking the page.
 *
 *   live      the last poll succeeded and every core source answered
 *   degraded  the last poll succeeded but some sources are unavailable
 *   offline   the last poll failed
 */
export function useDashboard(q: DashboardQuery, enabled = true) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [state, setState] = useState<LiveState>("connecting");
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const params = new URLSearchParams({ range: q.range, product: q.product });
  if (q.range === "custom" && q.from && q.to) {
    params.set("from", q.from);
    params.set("to", q.to);
  }
  const url = `/api/ops/analytics/dashboard?${params.toString()}`;
  const ready = enabled && (q.range !== "custom" || Boolean(q.from && q.to));

  const load = useCallback(async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; data: Dashboard }
        | { ok: false; error?: { message?: string } }
        | { error?: string }
        | null;
      if (!res.ok || !body || !("ok" in body) || !body.ok) {
        const message =
          (body && "error" in body && typeof body.error === "object" && body.error?.message) ||
          (body && "error" in body && typeof body.error === "string" && body.error) ||
          `Request failed (${res.status})`;
        setError({ status: res.status, message: String(message) });
        setState("offline");
        return;
      }
      setData(body.data);
      setError(null);
      setUpdatedAt(Date.now());
      setState(unavailableCount(body.data) > 0 ? "degraded" : "live");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError({ status: 0, message: "Network error — unable to reach the analytics API." });
      setState("offline");
    }
  }, [url]);

  useEffect(() => {
    if (!ready) return;
    setState((s) => (s === "live" || s === "degraded" ? s : "connecting"));
    void load();
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void load(), POLL_MS);
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
  }, [load, ready]);

  return { data, state, error, updatedAt, reload: load };
}
