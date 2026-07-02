"use client";

import { useEffect, useState } from "react";
import { OFFLINE_DATA_EVENT, ONLINE_DATA_EVENT, useOnline } from "@/lib/offline";

function age(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

// Slim global banner shown while offline — either navigator.onLine says so,
// or cached data was just served because the server was unreachable
// (OFFLINE_DATA_EVENT from lib/api.ts). A successful live response
// (ONLINE_DATA_EVENT) clears the stale state.
export default function OfflineBanner() {
  const online = useOnline();
  const [servedStale, setServedStale] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const onStale = (e: Event) => {
      const savedAt = (e as CustomEvent<{ savedAt: number }>).detail?.savedAt;
      if (savedAt) setLastSync((prev) => (prev === null ? savedAt : Math.max(prev, savedAt)));
      setServedStale(true);
    };
    const onFresh = () => setServedStale(false);
    window.addEventListener(OFFLINE_DATA_EVENT, onStale);
    window.addEventListener(ONLINE_DATA_EVENT, onFresh);
    return () => {
      window.removeEventListener(OFFLINE_DATA_EVENT, onStale);
      window.removeEventListener(ONLINE_DATA_EVENT, onFresh);
    };
  }, []);

  const visible = !online || servedStale;

  // Keep the "X min ago" label fresh while visible.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-[#332B00] px-4 py-2 text-center text-[12px] font-semibold text-[#FFD60A]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#FFD60A]" />
      {lastSync
        ? `Offline — showing data saved ${age(lastSync)}. Actions are disabled.`
        : "You're offline. Actions are disabled until you reconnect."}
    </div>
  );
}
