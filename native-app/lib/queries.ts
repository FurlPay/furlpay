import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, NetworkError } from "./api";
import { cacheGet, cacheSet, listCachedTransactions, upsertTransactions } from "./db";
import type { Overview, PaymentCard, Portfolio, Transaction } from "./types";

// ---------------------------------------------------------------------------
// Offline-first reads: every GET writes through to SQLite; when the network
// is unreachable the cached snapshot is served instead (with its timestamp,
// so screens can show "last updated X ago").
// ---------------------------------------------------------------------------

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
  updatedAt: number;
}

async function cachedFetch<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
  try {
    const data = await fetcher();
    cacheSet(cacheKey, data);
    return { data, fromCache: false, updatedAt: Date.now() };
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = cacheGet<T>(cacheKey);
      if (cached) return { data: cached.value, fromCache: true, updatedAt: cached.updatedAt };
    }
    throw e;
  }
}

export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: async () => {
      const result = await cachedFetch("overview", () => api<Overview>("/overview"));
      if (!result.fromCache) upsertTransactions(result.data.recentTransactions);
      return result;
    },
    staleTime: 15_000,
  });
}

export function useTransactions(category?: string) {
  return useQuery({
    queryKey: ["transactions", category ?? "all"],
    queryFn: async (): Promise<CachedResult<Transaction[]>> => {
      try {
        const qs = category ? `?category=${encodeURIComponent(category)}` : "";
        const res = await api<{ transactions: Transaction[] }>(`/transactions${qs}`);
        upsertTransactions(res.transactions);
        return { data: res.transactions, fromCache: false, updatedAt: Date.now() };
      } catch (e) {
        if (e instanceof NetworkError) {
          return { data: listCachedTransactions(category), fromCache: true, updatedAt: 0 };
        }
        throw e;
      }
    },
    staleTime: 15_000,
  });
}

export function useCards() {
  return useQuery({
    queryKey: ["cards"],
    queryFn: () => cachedFetch("cards", async () => (await api<{ cards: PaymentCard[] }>("/cards")).cards),
    staleTime: 30_000,
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => cachedFetch("portfolio", () => api<Portfolio>("/investing/portfolio")),
    staleTime: 30_000,
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
