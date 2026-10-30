// ---------------------------------------------------------------------------
// In-memory rate limit store.
//
// Uses a Map with automatic expiry. NOT suitable for multi-instance
// deployments — each instance tracks independently. Use the Redis store
// for production multi-instance configurations.
// ---------------------------------------------------------------------------

import type { RateLimitStore } from "../types.js";

interface Entry {
  count: number;
  resetAt: number; // Unix timestamp in seconds
}

/**
 * In-memory rate limit store.
 *
 * Good for: development, single-instance deployments, Edge functions.
 * Bad for: multi-instance deployments (use RedisRateLimitStore instead).
 *
 * Expired entries are cleaned up every 60 seconds to prevent memory leaks.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up expired entries every 60 seconds
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
      // Don't prevent process exit
      if (this.cleanupTimer && "unref" in this.cleanupTimer) {
        (this.cleanupTimer as NodeJS.Timeout).unref();
      }
    }
  }

  async increment(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.entries.get(key);

    if (existing && existing.resetAt > now) {
      // Within the current window — increment
      existing.count++;
      return { count: existing.count, resetAt: existing.resetAt };
    }

    // New window
    const entry: Entry = { count: 1, resetAt: now + windowSeconds };
    this.entries.set(key, entry);
    return { count: 1, resetAt: entry.resetAt };
  }

  async peek(key: string): Promise<{ count: number; resetAt: number } | null> {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) return null;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  /** Remove expired entries. */
  private cleanup(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  /** Stop the cleanup timer and clear all entries. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}
