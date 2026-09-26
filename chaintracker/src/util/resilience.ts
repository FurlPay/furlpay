// Rate limiting, retry and circuit breaking.
//
// These are the three things that decide whether a free tier survives contact
// with 28 chains. Every outbound provider call goes through all three, so the
// budget maths in the collectors can assume calls are already paced.

import { makeLogger } from "./logger.js";

const log = makeLogger("resilience");

/* ------------------------------------------------------------------ */
/* Rate limiter                                                        */
/* ------------------------------------------------------------------ */

/**
 * Token bucket with a queue. Callers await a slot rather than being rejected,
 * because a delayed price refresh is always better than a dropped one.
 */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly name: string,
    /** Sustained rate. */
    private readonly perSecond: number,
    /** Burst size; defaults to one second of capacity. */
    private readonly burst = Math.max(1, Math.ceil(perSecond)),
  ) {
    this.tokens = this.burst;
  }

  private refill(): void {
    const now = Date.now();
    const gained = ((now - this.last) / 1000) * this.perSecond;
    if (gained > 0) {
      this.tokens = Math.min(this.burst, this.tokens + gained);
      this.last = now;
    }
  }

  private pump(): void {
    this.refill();
    while (this.queue.length && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length && !this.timer) {
      const wait = Math.max(15, Math.ceil(((1 - this.tokens) / this.perSecond) * 1000));
      // NOT unref'd: this timer is the only thing that will drain the queue.
      // Unref-ing it lets Node exit while callers are still awaiting a slot,
      // which silently kills a collection run mid-flight.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
    }
  }

  /** Resolves when the caller is allowed to make one request. */
  acquire(): Promise<void> {
    this.refill();
    if (!this.queue.length && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((res) => {
      this.queue.push(res);
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length;
  }
}

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

export type BreakerState = "closed" | "open" | "half-open";

/**
 * Opens after `threshold` consecutive failures and stays open for `cooldownMs`,
 * then lets a single probe through. Keeps a dead provider from burning the
 * whole scheduler tick on socket timeouts.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;
  state: BreakerState = "closed";
  lastError: string | null = null;

  constructor(
    readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 60_000,
  ) {}

  /** True when a call may proceed. */
  canRequest(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        this.probing = false;
      } else {
        return false;
      }
    }
    if (this.state === "half-open") {
      if (this.probing) return false;
      this.probing = true;
      return true;
    }
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.lastError = null;
    this.probing = false;
    if (this.state !== "closed") {
      log.info("circuit closed", { provider: this.name });
      this.state = "closed";
    }
  }

  onFailure(err: unknown): void {
    this.failures += 1;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.probing = false;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      if (this.state !== "open") {
        log.warn("circuit opened", {
          provider: this.name,
          failures: this.failures,
          err: this.lastError,
        });
      }
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  get retryInMs(): number {
    return this.state === "open"
      ? Math.max(0, this.cooldownMs - (Date.now() - this.openedAt))
      : 0;
  }
}

/** Raised when a breaker refuses a call — distinct so callers can fall back. */
export class CircuitOpenError extends Error {
  constructor(name: string, retryInMs: number) {
    super(`circuit open for ${name}, retry in ${Math.ceil(retryInMs / 1000)}s`);
    this.name = "CircuitOpenError";
  }
}

/* ------------------------------------------------------------------ */
/* Retry                                                               */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 180)}`);
    this.name = "HttpError";
  }
  /** 429 and 5xx are worth another go; other 4xx generally are not. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, err: unknown, waitMs: number) => void;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res, rej) => {
    // Also not unref'd — a backoff wait must keep the process alive.
    const t = setTimeout(res, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("aborted"));
      },
      { once: true },
    );
  });

/** Exponential backoff with full jitter, honouring Retry-After when present. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 400;
  const max = opts.maxMs ?? 15_000;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      const retryable =
        err instanceof HttpError
          ? err.retryable
          : err instanceof CircuitOpenError
            ? false
            : true;
      if (isLast || !retryable) break;

      let wait = Math.min(max, base * 2 ** i);
      if (err instanceof HttpError && err.status === 429) {
        const m = /retry-after[^0-9]*([0-9]+)/i.exec(err.body);
        if (m) wait = Math.min(max, Number(m[1]) * 1000);
        else wait = Math.min(max, wait * 2);
      }
      wait = Math.round(wait * (0.5 + Math.random() * 0.5)); // full jitter
      opts.onRetry?.(i + 1, err, wait);
      await sleep(wait, opts.signal);
    }
  }
  throw lastErr;
}

/** Reject after `ms` so a hung socket cannot stall a collector tick. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    t.unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

/** Run over `items` with at most `n` in flight; output order matches input. */
export async function pool<T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const out: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
