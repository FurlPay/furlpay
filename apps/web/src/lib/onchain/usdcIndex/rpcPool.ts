// Provider pool for the USDC index: the keyless archive RPCs verified by the
// census (identical USDC log counts at blocks 7M/12M/18M/22M/26M, 2026-10-07).
// USDC_INDEX_RPC_URLS overrides the list. Alchemy is deliberately excluded
// from this index for now; a URL naming it is refused, not used.
//
// Per provider: adaptive eth_getLogs span (halved on range/size/timeout
// errors, doubled on small responses, capped at a limit the provider states),
// in-flight cap, pause with exponential backoff on rate limits and errors, and
// health counters that are persisted with the index state.

export const DEFAULT_USDC_INDEX_RPCS = [
  "https://rpc.mevblocker.io",
  "https://mainnet.gateway.tenderly.co",
  "https://rpc.sentio.xyz/mainnet",
  "https://eth-pokt.nodies.app",
  "https://eth-mainnet.public.blastapi.io",
];
// tatum's public endpoint (5 requests/minute) and blockpi's (~20 s per call)
// pass the census checks but are too slow for a 60 s indexing pass.
const MAX_SPAN = 10_000;
const PER_PROVIDER = 3;

export interface ProviderHealth {
  host: string;
  span: number;
  cap: number | null;
  ok: number;
  rangeErrors: number;
  rateLimited: number;
  otherErrors: number;
  avgLatencyMs: number | null;
  lastSuccess: string | null;
  lastError: string | null;
}

interface Provider extends ProviderHealth {
  url: string;
  latencyTotal: number;
  inflight: number;
  until: number;
  streak: number;
  head: number;
  headAt: number;
  primary: boolean;
}

export class RpcError extends Error {
  constructor(message: string, readonly range: boolean, readonly rate: boolean) {
    super(message);
  }
}

const isRate = (m: string) => /rate|429|too many requests|capacity|throttl/i.test(m);
const isRange = (m: string) => !isRate(m) && /range|too many|exceed|10000|results|response size|query returned more|block range|timeout|abort/i.test(m);

/** Optional keyed/self-hosted primary (USDC_INDEX_PRIMARY_RPC_URL); the keyless pool stays as fallback. */
export function primaryUrl(): string | null {
  const v = process.env.USDC_INDEX_PRIMARY_RPC_URL?.trim();
  return v ? v : null;
}

export function poolUrls(): string[] {
  const env = process.env.USDC_INDEX_RPC_URLS?.split(",").map((s) => s.trim()).filter(Boolean);
  const pool = env && env.length ? env : DEFAULT_USDC_INDEX_RPCS;
  const primary = primaryUrl();
  const urls = primary ? [primary, ...pool.filter((u) => u !== primary)] : pool;
  const bad = urls.filter((u) => /alchemy/i.test(u) || !/^https:\/\//.test(u));
  if (bad.length) throw new Error("USDC_INDEX_RPC_URLS / USDC_INDEX_PRIMARY_RPC_URL must be https URLs and must not use Alchemy");
  return urls;
}

export class RpcPool {
  private providers: Provider[];
  constructor(urls: string[] = poolUrls()) {
    this.providers = urls.map((url) => ({
      url,
      host: new URL(url).host,
      span: 100,
      cap: null,
      ok: 0,
      rangeErrors: 0,
      rateLimited: 0,
      otherErrors: 0,
      avgLatencyMs: null,
      lastSuccess: null,
      lastError: null,
      latencyTotal: 0,
      inflight: 0,
      until: 0,
      streak: 0,
      head: 0,
      headAt: 0,
      primary: url === primaryUrl(),
    }));
  }

  health(): ProviderHealth[] {
    return this.providers.map(({ host, span, cap, ok, rangeErrors, rateLimited, otherErrors, lastSuccess, lastError, latencyTotal }) => ({
      host,
      span,
      cap,
      ok,
      rangeErrors,
      rateLimited,
      otherErrors,
      avgLatencyMs: ok ? Math.round(latencyTotal / ok) : null,
      lastSuccess,
      lastError,
    }));
  }

  private pick(): Provider | null {
    const now = Date.now();
    let best: Provider | null = null;
    let score = Infinity;
    for (const p of this.providers) {
      if (p.until > now || p.inflight >= (p.primary ? PER_PROVIDER * 3 : PER_PROVIDER)) continue;
      // The primary (keyed or self-hosted) is strongly preferred while healthy;
      // the keyless providers carry what it cannot, and everything when it is paused.
      const s = (p.inflight + 1) * (p.ok ? p.latencyTotal / p.ok : 1000) * (p.primary ? 0.2 : 1);
      if (s < score) (best = p), (score = s);
    }
    return best;
  }

  private async acquire(deadline: () => boolean): Promise<Provider> {
    for (;;) {
      const p = this.pick();
      if (p) return p;
      if (deadline()) throw new RpcError("no provider available before the deadline", false, true);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async call<T>(p: Provider, method: string, params: unknown[], timeoutMs: number): Promise<T> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    const t0 = Date.now();
    p.inflight++;
    try {
      const r = await fetch(p.url, { method: "POST", signal: c.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store" });
      const text = await r.text();
      if (r.status === 429) throw new Error("HTTP 429 too many requests");
      let b: { result?: T; error?: { message?: string; code?: number } };
      try {
        b = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${r.status} non-JSON`);
      }
      if (b.error) throw new Error(String(b.error.message ?? b.error.code));
      p.ok++;
      p.latencyTotal += Date.now() - t0;
      p.lastSuccess = new Date().toISOString();
      p.streak = 0;
      return b.result as T;
    } catch (e) {
      const m = (e as Error).name === "AbortError" ? "timeout" : String((e as Error).message);
      p.lastError = `${new Date().toISOString()} ${m.slice(0, 120)}`;
      p.streak++;
      if (isRate(m)) {
        p.rateLimited++;
        p.until = Date.now() + Math.min(120_000, 1000 * 2 ** Math.min(p.streak, 7));
      } else if (isRange(m)) p.rangeErrors++;
      else {
        p.otherErrors++;
        p.until = Date.now() + Math.min(60_000, 500 * 2 ** Math.min(p.streak, 7));
      }
      const cap = /(?:maximum allowed is|limit of|up to an?|max(?:imum)? (?:block )?range(?: is| of)?)\s*(\d{1,6})/i.exec(m);
      if (cap && isRange(m)) {
        p.cap = Math.max(1, Number(cap[1]));
        p.span = Math.min(p.span, p.cap);
      }
      throw new RpcError(m, isRange(m), isRate(m));
    } finally {
      p.inflight--;
      clearTimeout(t);
    }
  }

  /** Any healthy provider; retried across providers. */
  async rpc<T>(method: string, params: unknown[], deadline: () => boolean = () => false): Promise<T> {
    let last: unknown;
    for (let i = 0; i < 8; i++) {
      const p = await this.acquire(deadline);
      try {
        return await this.call<T>(p, method, params, 30_000);
      } catch (e) {
        last = e;
        if (deadline()) break;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  /**
   * Logs for [from, end] with end <= to, on one provider's current span. A
   * provider is only asked for blocks at or below its OWN head: some return an
   * empty list (not an error) for blocks they have not reached, which would
   * silently drop events.
   */
  async getLogsChunk<L>(filter: { address: string; topics: string[] }, from: number, to: number, deadline: () => boolean): Promise<{ logs: L[]; end: number; host: string }> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = await this.acquire(deadline);
      const end = Math.min(to, from + p.span - 1);
      if (p.head < end || Date.now() - p.headAt > 60_000) {
        try {
          p.head = Number(BigInt(await this.call<string>(p, "eth_blockNumber", [], 10_000)));
          p.headAt = Date.now();
        } catch {
          continue;
        }
        if (p.head < end) {
          p.lastError = `${new Date().toISOString()} head ${p.head} is behind block ${end}`;
          p.until = Date.now() + 15_000;
          continue;
        }
      }
      try {
        const logs = await this.call<L[]>(p, "eth_getLogs", [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${end.toString(16)}` }], 45_000);
        if (logs.length < 2500 && p.span < (p.cap ?? MAX_SPAN)) p.span = Math.min(p.cap ?? MAX_SPAN, p.span * 2);
        return { logs, end, host: p.host };
      } catch (e) {
        const err = e as RpcError;
        if ((err.range || (!err.rate && p.streak >= 2)) && p.span > 1) p.span = Math.max(1, Math.floor(p.span / 2));
        if (deadline()) throw e;
      }
    }
    throw new Error(`eth_getLogs ${from}..${to} failed on every provider`);
  }
}
