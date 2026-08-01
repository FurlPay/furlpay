"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJSON, HttpError } from "@/lib/api";
import type { Period } from "@/lib/expenses/periods";
import type { ExpenseSummaryResponse } from "@/app/api/expenses/summary/route";
import type { FiatBalance, TokenBalance, Transaction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Typed data hooks for the terminal.
//
// Deliberately built on fetch + useState rather than TanStack Query. The rest
// of apps/web reads data this way; introducing a second data-fetching paradigm
// for one route means two cache models, two loading conventions and two places
// to look when something is stale — during a production launch, that cost is
// real and the benefit is a dashboard that refreshes slightly more elegantly.
//
// Every hook returns the SAME shape: { data, error, loading, refresh }. A panel
// can therefore render loading, error and empty states without knowing which
// endpoint it is bound to.
// ---------------------------------------------------------------------------

export interface Async<T> {
  data: T | null;
  error: string | null;
  /** HTTP status when the failure was an HTTP error, for status-specific UI. */
  status: number | null;
  loading: boolean;
  refresh: () => void;
}

/** A message a user can act on, keyed off the HTTP status. `getJSON` throws
 *  HttpError with a raw "GET /path failed: 423" string, which is a stack-trace
 *  detail, not something to show someone checking their balances. */
function humanError(e: unknown): { message: string; status: number | null } {
  if (e instanceof HttpError) {
    switch (e.status) {
      case 401:
        return { message: "Your session expired. Sign in again.", status: 401 };
      case 423:
        return {
          message: "This account is locked. Unlock it from Security settings to see your data.",
          status: 423,
        };
      case 429:
        return { message: "Too many requests — give it a moment and refresh.", status: 429 };
      case 503:
        return { message: "This service isn't available right now.", status: 503 };
      default:
        return { message: `Couldn't load data (${e.status}).`, status: e.status };
    }
  }
  return { message: e instanceof Error ? e.message : "Request failed", status: null };
}

/**
 * Fetch `path` and track its lifecycle.
 *
 * Each request owns an AbortController and a generation number. Without both,
 * switching period week → month → week can land the first response last and
 * repaint the screen with figures for a period the user is no longer viewing —
 * the same stale-response hazard the swap screen guards against, and just as
 * misleading when the numbers are money.
 */
function useEndpoint<T>(path: string | null, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!path) return;
    const mine = ++generation.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setStatus(null);

    getJSON<T>(path, { signal: ctrl.signal })
      .then((res) => {
        if (mine !== generation.current) return; // superseded
        setData(res);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || mine !== generation.current) return;
        const { message, status: s } = humanError(e);
        setError(message);
        setStatus(s);
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, status, loading, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

// ── Overview ───────────────────────────────────────────────────────────────

export interface Overview {
  user: { name: string; tier: string; region: string; safeAddress: string };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
}

export function useOverview(): Async<Overview> {
  return useEndpoint<Overview>("/api/overview");
}

// ── Expenses ───────────────────────────────────────────────────────────────

export function useExpenses(period: Period): Async<ExpenseSummaryResponse> {
  return useEndpoint<ExpenseSummaryResponse>(`/api/expenses/summary?period=${period}`);
}

// ── Portfolio ──────────────────────────────────────────────────────────────

export interface PortfolioHolding {
  symbol: string;
  name?: string;
  shares: number;
  price: number;
  marketValue: number;
  changePct?: number;
}

export interface Portfolio {
  holdings: PortfolioHolding[];
  performance: { marketValue: number; dayChange: number; dayChangePct: number };
}

export function usePortfolio(): Async<Portfolio> {
  return useEndpoint<Portfolio>("/api/investing/portfolio");
}

// ── Markets ────────────────────────────────────────────────────────────────

export interface MarketRow {
  symbol: string;
  name: string;
  kind: string;
  price?: number;
  changePct?: number;
  logo?: string | null;
}

export function useMarkets(): Async<{ assets: MarketRow[] }> {
  return useEndpoint<{ assets: MarketRow[] }>("/api/markets");
}

// ── Tokenized assets (read-only, per the RWA legal boundary) ───────────────

export interface RwaPosition {
  symbol: string;
  token: string;
  shares: number;
  chain: string;
  issuer: string;
  price: number;
  marketValue: number;
  custody: "self-custody";
}

export interface RwaResponse {
  tokenized: RwaPosition[];
  summary: { tokenizedValue: number; brokerageValue: number; totalEquityValue: number };
  unified: { symbol: string; totalShares: number; brokerageShares: number; tokenizedShares: number; marketValue: number }[];
}

export function useTokenizedAssets(): Async<RwaResponse> {
  return useEndpoint<RwaResponse>("/api/investing/rwa");
}

// ── Trips ──────────────────────────────────────────────────────────────────

export interface Trip {
  id: string;
  name: string;
  city: string;
  amountUsd: number;
  cashbackUsd: number;
  status: string;
  method: string;
  checkIn: string;
  checkOut: string;
  createdAt: string;
}

export function useTrips(): Async<{ trips: Trip[] }> {
  return useEndpoint<{ trips: Trip[] }>("/api/travel/trips");
}

// ── Agents (the real control-plane data) ───────────────────────────────────

export interface AgentRow {
  id: string;
  name: string;
  status: "active" | "paused" | "stopped";
  spentToday?: number;
  model?: string;
}

export interface AgentsResponse {
  agents: AgentRow[];
  summary: { activeAgents: number; totalSpentToday: number; pendingApprovals: number };
}

export function useAgents(): Async<AgentsResponse> {
  return useEndpoint<AgentsResponse>("/api/agents");
}

// ── Market movers (watchlist) ──────────────────────────────────────────────

export interface Mover {
  symbol: string;
  name: string;
  kind: string;
  price?: number;
  changePct?: number;
  logo?: string | null;
}

export function useMovers(): Async<{ gainers: Mover[]; losers: Mover[]; asOf: string }> {
  return useEndpoint<{ gainers: Mover[]; losers: Mover[]; asOf: string }>("/api/markets/movers");
}

// ── Cards ──────────────────────────────────────────────────────────────────

export interface CardRow {
  id: string;
  label: string;
  last4: string;
  kind: string;
  network: string;
  frozen: boolean;
  gradient?: string;
  limits?: { perTransaction?: number; daily?: number; monthly?: number };
}

export function useCards(): Async<{ cards: CardRow[] }> {
  return useEndpoint<{ cards: CardRow[] }>("/api/cards");
}
