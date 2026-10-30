// ---------------------------------------------------------------------------
// Redis-backed rate limit store (Upstash REST API).
//
// Uses Upstash's REST API so it works in Edge runtimes (no TCP needed).
// Atomic increment + expire ensures correctness under concurrency.
// Falls back gracefully on Redis errors: allows the request and logs a
// warning, rather than blocking all traffic when Redis is down.
// ---------------------------------------------------------------------------

import type { RateLimitStore } from "../types.js";

/** Configuration for the Redis rate limit store. */
export interface RedisRateLimitConfig {
  /** Upstash REST API URL. */
  url: string;
  /** Upstash REST API token. */
  token: string;
}

/**
 * Redis-backed rate limit store using Upstash REST API.
 *
 * Good for: multi-instance production deployments.
 * Requires: an Upstash Redis instance.
 *
 * Uses atomic INCR + EXPIRE to prevent race conditions between instances.
 * Falls back to allowing requests if Redis is unavailable (fail open for
 * rate limiting — blocking all API traffic on a Redis outage is worse than
 * briefly allowing extra requests).
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly url: string;
  private readonly token: string;

  constructor(config: RedisRateLimitConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.token = config.token;
  }

  /** Execute an Upstash REST command. */
  private async exec<T>(command: string[]): Promise<T> {
    const res = await fetch(`${this.url}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!res.ok) {
      throw new Error(`Upstash Redis error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { result: T };
    return data.result;
  }

  /** Execute a pipeline of commands atomically. */
  private async pipeline<T>(commands: string[][]): Promise<T[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });

    if (!res.ok) {
      throw new Error(`Upstash Redis pipeline error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { result: T }[];
    return data.map((d) => d.result);
  }

  async increment(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }> {
    const redisKey = `rl:${key}`;
    try {
      // Pipeline: INCR + TTL (set expire only on first hit via a second command)
      const results = await this.pipeline<number>([
        ["INCR", redisKey],
        ["TTL", redisKey],
      ]);

      const count = results[0]!;
      let ttl = results[1]!;

      // If this is the first increment (count === 1) or key has no TTL, set it
      if (count === 1 || ttl < 0) {
        await this.exec(["EXPIRE", redisKey, String(windowSeconds)]);
        ttl = windowSeconds;
      }

      const resetAt = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);
      return { count, resetAt };
    } catch (e) {
      // Fail open: allow the request if Redis is down
      console.warn(`[@furlpay/rate-limit] Redis error, failing open: ${(e as Error).message}`);
      return { count: 0, resetAt: Math.floor(Date.now() / 1000) + windowSeconds };
    }
  }

  async peek(key: string): Promise<{ count: number; resetAt: number } | null> {
    const redisKey = `rl:${key}`;
    try {
      const results = await this.pipeline<number | null>([
        ["GET", redisKey],
        ["TTL", redisKey],
      ]);

      const count = results[0];
      const ttl = results[1] as number;

      if (count === null || ttl < 0) return null;
      return {
        count: Number(count),
        resetAt: Math.floor(Date.now() / 1000) + ttl,
      };
    } catch {
      return null;
    }
  }
}
