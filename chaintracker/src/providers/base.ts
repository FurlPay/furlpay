// The one place an outbound request is actually made.
//
// Every adapter extends `Provider`, so rate limiting, breaker state, retry,
// timeout and usage accounting are applied uniformly and cannot be forgotten in
// a new adapter. `units` is the provider's own cost metric (Alchemy compute
// units, CoinGecko calls) and is what /providers reports against the free tier.

import { usage } from "../db/index.js";
import { makeLogger, type Logger } from "../util/logger.js";
import {
  CircuitBreaker,
  CircuitOpenError,
  HttpError,
  RateLimiter,
  withRetry,
  withTimeout,
} from "../util/resilience.js";
import type { ProviderHealth, ProviderKind } from "../types/index.js";

export interface ProviderOptions {
  name: string;
  kind: ProviderKind;
  configured: boolean;
  /** Sustained requests per second this provider tolerates. */
  rps: number;
  timeoutMs?: number;
  attempts?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  /** Free-tier ceiling for the metered unit, when one exists. */
  budgetLimit?: number | null;
}

export interface RequestOptions {
  /** Cost in provider units; defaults to 1 (one call). */
  units?: number;
  /** Isolate breaker state per target (e.g. one chain), not per provider. */
  breakerKey?: string;
  /**
   * Errors matching this are expected control flow, not provider ill-health —
   * an oversized eth_getLogs range means "ask for less", so it must not count
   * toward opening the breaker.
   */
  benign?: (err: unknown) => boolean;
  timeoutMs?: number;
  attempts?: number;
  signal?: AbortSignal;
  /** Label used in logs and errors — keeps URLs with keys out of messages. */
  label?: string;
}

export abstract class Provider {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly configured: boolean;
  protected readonly log: Logger;
  protected readonly limiter: RateLimiter;
  protected readonly breaker: CircuitBreaker;
  /**
   * Per-target breakers. A provider that fronts many independent endpoints —
   * evm-rpc serves 13 chains — must not let one failing chain quarantine the
   * rest, so callers pass a `breakerKey` and each key trips on its own.
   */
  private readonly keyedBreakers = new Map<string, CircuitBreaker>();
  private readonly breakerOpts: { threshold: number; cooldownMs: number };
  private readonly timeoutMs: number;
  private readonly attempts: number;
  readonly budgetLimit: number | null;

  private calls = 0;
  private failures = 0;
  private latencySum = 0;
  lastOkAt: number | null = null;
  lastErrorAt: number | null = null;
  lastError: string | null = null;

  constructor(opts: ProviderOptions) {
    this.name = opts.name;
    this.kind = opts.kind;
    this.configured = opts.configured;
    this.log = makeLogger(opts.name);
    this.limiter = new RateLimiter(opts.name, opts.rps);
    this.breaker = new CircuitBreaker(
      opts.name,
      opts.breakerThreshold ?? 5,
      opts.breakerCooldownMs ?? 60_000,
    );
    this.breakerOpts = {
      threshold: opts.breakerThreshold ?? 5,
      cooldownMs: opts.breakerCooldownMs ?? 60_000,
    };
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.attempts = opts.attempts ?? 3;
    this.budgetLimit = opts.budgetLimit ?? null;
  }

  /** The breaker guarding one target, creating it on first use. */
  protected breakerFor(key?: string): CircuitBreaker {
    if (!key) return this.breaker;
    let b = this.keyedBreakers.get(key);
    if (!b) {
      b = new CircuitBreaker(
        `${this.name}:${key}`,
        this.breakerOpts.threshold,
        this.breakerOpts.cooldownMs,
      );
      this.keyedBreakers.set(key, b);
    }
    return b;
  }

  /** Keyed breakers that are not currently closed — surfaced by /providers. */
  degradedTargets(): Array<{ key: string; state: string; error: string | null }> {
    const out: Array<{ key: string; state: string; error: string | null }> = [];
    for (const [key, b] of this.keyedBreakers) {
      if (b.state !== "closed") out.push({ key, state: b.state, error: b.lastError });
    }
    return out;
  }

  /**
   * Rate-limited, retried, breaker-guarded JSON request.
   * Throws `CircuitOpenError` when the provider is quarantined, which callers
   * treat as "try the next provider" rather than "the data does not exist".
   */
  protected async request<T>(
    url: string,
    init: RequestInit = {},
    opts: RequestOptions = {},
  ): Promise<T> {
    const breaker = this.breakerFor(opts.breakerKey);
    if (!breaker.canRequest()) {
      throw new CircuitOpenError(breaker.name, breaker.retryInMs);
    }
    const label = opts.label ?? new URL(url).pathname;
    const units = opts.units ?? 1;
    const started = Date.now();

    try {
      const result = await withRetry(
        async () => {
          await this.limiter.acquire();
          const res = await withTimeout(
            fetch(url, {
              ...init,
              headers: { accept: "application/json", ...(init.headers ?? {}) },
              signal: opts.signal ?? null,
            }),
            opts.timeoutMs ?? this.timeoutMs,
            `${this.name} ${label}`,
          );
          if (!res.ok) {
            throw new HttpError(res.status, await res.text().catch(() => ""), `${this.name}/${label}`);
          }
          return (await res.json()) as T;
        },
        {
          attempts: opts.attempts ?? this.attempts,
          signal: opts.signal,
          onRetry: (n, err, wait) =>
            this.log.debug("retry", {
              label,
              attempt: n,
              waitMs: wait,
              err: err instanceof Error ? err.message.slice(0, 120) : String(err),
            }),
        },
      );
      this.recordSuccess(Date.now() - started, units, breaker);
      return result;
    } catch (err) {
      this.recordFailure(err, Date.now() - started, units, breaker, opts.benign);
      throw err;
    }
  }

  /** JSON-RPC 2.0 helper — the shape most blockchain calls take. */
  protected async rpc<T>(
    url: string,
    method: string,
    params: unknown[] = [],
    opts: RequestOptions = {},
  ): Promise<T> {
    const body = await this.request<{ result?: T; error?: { code: number; message: string } }>(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      },
      { ...opts, label: opts.label ?? method },
    );
    if (body.error) {
      throw new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    }
    if (body.result === undefined) throw new Error(`${method}: empty result`);
    return body.result;
  }

  /**
   * Batched JSON-RPC. One HTTP round trip for N calls, which is the difference
   * between a viable and an unviable block scanner on a free tier.
   */
  protected async rpcBatch<T>(
    url: string,
    calls: Array<{ method: string; params?: unknown[] }>,
    opts: RequestOptions = {},
  ): Promise<Array<T | null>> {
    if (!calls.length) return [];
    const payload = calls.map((c, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: c.method,
      params: c.params ?? [],
    }));
    const body = await this.request<Array<{ id: number; result?: T; error?: { message: string } }>>(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      { ...opts, units: opts.units ?? calls.length, label: opts.label ?? `batch(${calls.length})` },
    );
    const out: Array<T | null> = new Array(calls.length).fill(null);
    if (!Array.isArray(body)) return out;
    for (const entry of body) {
      if (entry && typeof entry.id === "number" && entry.id < out.length) {
        out[entry.id] = entry.error ? null : (entry.result ?? null);
      }
    }
    return out;
  }

  private recordSuccess(ms: number, units: number, breaker: CircuitBreaker): void {
    this.calls += 1;
    this.latencySum += ms;
    this.lastOkAt = Date.now();
    breaker.onSuccess();
    try {
      usage.record(this.name, units, ms, true);
    } catch {
      /* usage accounting must never break a data path */
    }
  }

  private recordFailure(
    err: unknown,
    ms: number,
    units: number,
    breaker: CircuitBreaker,
    benign?: (e: unknown) => boolean,
  ): void {
    this.calls += 1;
    this.latencySum += ms;
    this.lastErrorAt = Date.now();
    this.lastError = err instanceof Error ? err.message.slice(0, 300) : String(err);

    // An error the caller declared benign is expected control flow — it says
    // "ask differently", not "this provider is unhealthy".
    if (benign?.(err)) return;
    this.failures += 1;

    // A refused call never reached the provider, so it costs nothing and must
    // not be counted against the breaker a second time.
    if (!(err instanceof CircuitOpenError)) {
      breaker.onFailure(err);
      try {
        usage.record(this.name, units, ms, false);
      } catch {
        /* ignore */
      }
    }
  }

  health(): ProviderHealth {
    let budgetUsed: number | null = null;
    try {
      budgetUsed = usage.month(this.name).units;
    } catch {
      budgetUsed = null;
    }
    return {
      name: this.name,
      kind: this.kind,
      configured: this.configured,
      state: this.breaker.state,
      lastOkAt: this.lastOkAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      calls: this.calls,
      failures: this.failures,
      avgLatencyMs: this.calls ? Math.round(this.latencySum / this.calls) : null,
      budgetUsed,
      budgetLimit: this.budgetLimit,
    };
  }

  /** A cheap call proving the provider answers. Used by /providers and doctor. */
  abstract ping(): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* Shared EVM helpers                                                  */
/* ------------------------------------------------------------------ */

export const hexToNum = (h: string | null | undefined): number | null => {
  if (typeof h !== "string" || !h.startsWith("0x")) return null;
  const n = Number.parseInt(h, 16);
  return Number.isFinite(n) ? n : null;
};

export const hexToBig = (h: string | null | undefined): bigint => {
  if (typeof h !== "string" || !h.startsWith("0x")) return 0n;
  try {
    return BigInt(h);
  } catch {
    return 0n;
  }
};

/** bigint wei → float token units. Precision is fine for display and USD maths. */
export function fromWei(v: bigint, decimals: number): number {
  if (decimals <= 0) return Number(v);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** A 32-byte topic to a 20-byte checksum-less address. */
export function topicToAddress(topic: string): string {
  if (typeof topic !== "string" || topic.length < 42) return "";
  return "0x" + topic.slice(-40).toLowerCase();
}

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
