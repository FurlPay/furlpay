"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/auth/SessionProvider";

// ---------------------------------------------------------------------------
// The starred-assets hook.
//
// Two things make this more than a fetch wrapper.
//
// 1. RESUMING THE INTERRUPTED ACTION. Pressing the star while signed out is a
//    statement of intent, and the sign-in page is an interruption of it. The
//    symbol is parked in sessionStorage before the redirect and replayed the
//    moment a session appears, so the user comes back to the asset ALREADY
//    starred rather than to a page that forgot why they left it.
//
//    sessionStorage, not localStorage: the intent belongs to this tab and this
//    visit. A symbol stashed on a machine last week should not silently join
//    someone's watchlist on their next login.
//
// 2. OPTIMISTIC WITH A REAL ROLLBACK. A star that waits for a round trip feels
//    broken, so the toggle paints immediately — and puts the previous state
//    back if the server refuses. The failure is surfaced, not swallowed: a star
//    that quietly un-stars itself with no explanation is worse than a slow one.
// ---------------------------------------------------------------------------

const PENDING_KEY = "furlpay:watchlist:pending";

interface WatchlistResponse {
  authenticated: boolean;
  symbols: string[];
  max: number;
}

export interface WatchlistState {
  symbols: Set<string>;
  count: number;
  loading: boolean;
  /** The last write error, for the caller to surface. Cleared on the next try. */
  error: string | null;
  has: (symbol: string) => boolean;
  /** Star / un-star. Returns false when a sign-in is required instead. */
  toggle: (symbol: string) => Promise<boolean>;
  /** Park a symbol to be starred right after the user signs in. */
  rememberPending: (symbol: string) => void;
}

export function useWatchlist(): WatchlistState {
  const { status } = useSession();
  const [symbols, setSymbols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards the replay so a re-render cannot fire the same add twice.
  const replayed = useRef(false);

  const apply = useCallback((list: string[]) => {
    setSymbols(new Set(list.map((s) => s.toUpperCase())));
  }, []);

  const write = useCallback(
    async (symbol: string, method: "POST" | "DELETE"): Promise<boolean> => {
      const res = await fetch("/api/markets/watchlist", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Your watchlist could not be updated.");
        return false;
      }
      const data = (await res.json()) as WatchlistResponse;
      apply(data.symbols);
      return true;
    },
    [apply]
  );

  // Initial load, and a reload whenever the session state changes — signing in
  // must swap an empty list for the real one without a page refresh.
  useEffect(() => {
    if (status === "loading" || status === "idle") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/markets/watchlist", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as WatchlistResponse;
        if (cancelled) return;
        apply(data.symbols);

        // The interrupted action, resumed.
        if (data.authenticated && !replayed.current) {
          replayed.current = true;
          const pending = readPending();
          if (pending && !data.symbols.includes(pending)) {
            clearPending();
            await write(pending, "POST");
          } else if (pending) {
            clearPending();
          }
        }
      } catch {
        // Leave the list empty and un-starred. A watchlist that cannot be read
        // is a missing convenience, not a reason to fail the markets page.
        if (!cancelled) apply([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, apply, write]);

  const has = useCallback((symbol: string) => symbols.has(symbol.toUpperCase()), [symbols]);

  const toggle = useCallback(
    async (raw: string): Promise<boolean> => {
      const symbol = raw.toUpperCase();
      setError(null);

      if (status !== "authenticated") {
        rememberPending(symbol);
        return false;
      }

      const starred = symbols.has(symbol);
      const previous = symbols;
      // Paint first.
      setSymbols((prev) => {
        const next = new Set(prev);
        if (starred) next.delete(symbol);
        else next.add(symbol);
        return next;
      });

      const ok = await write(symbol, starred ? "DELETE" : "POST");
      if (!ok) setSymbols(previous);
      return true;
    },
    [status, symbols, write]
  );

  return {
    symbols,
    count: symbols.size,
    loading,
    error,
    has,
    toggle,
    rememberPending,
  };
}

// --- pending-intent storage -------------------------------------------------

export function rememberPending(symbol: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, symbol.toUpperCase());
  } catch {
    // Private mode, or storage disabled. The user still signs in; they just
    // land without the asset pre-starred.
  }
}

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clean up */
  }
}
