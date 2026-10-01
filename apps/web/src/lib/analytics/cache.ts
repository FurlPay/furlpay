import { buildDashboard, type Dashboard, type ProductFilter } from "./dashboard";
import type { AnalyticsRange } from "./range";

// One build per (range, product) per 15 seconds per instance: several admins,
// tabs and the four section endpoints share it instead of each re-running the
// same queries on every poll. The window matches the dashboard's poll interval,
// so the data is never staler than one tick. Concurrent callers share the
// in-flight promise rather than racing duplicate builds.

const TTL_MS = 15_000;
const MAX_ENTRIES = 50;
const cache = new Map<string, { at: number; value: Promise<Dashboard> }>();

export function dashboardCached(range: AnalyticsRange, product: ProductFilter, now = Date.now()): Promise<Dashboard> {
  // Bucketed to the minute for rolling ranges, so a 15s-old `now` still hits.
  const key = `${range.key}|${range.key === "custom" ? `${range.fromMs}-${range.toMs}` : Math.floor(range.toMs / 60_000)}|${product}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = buildDashboard(range, product);
  cache.set(key, { at: now, value });
  // A failed build must not be served for the rest of the window.
  value.catch(() => cache.delete(key));
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

export function __resetDashboardCacheForTests(): void {
  cache.clear();
}
