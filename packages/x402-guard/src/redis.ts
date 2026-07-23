// ---------------------------------------------------------------------------
// Redis-backed stores — the multi-process implementations of the same
// interfaces the in-memory defaults satisfy.
//
// WHY THIS FILE EXISTS. Every atomicity claim the in-memory stores make rests
// on Node being single-threaded: `MemoryNonceStore.acquire` is safe only
// because no `await` sits between its read and its write. That is a real
// guarantee, and it is worth exactly nothing across two workers, two lambdas,
// or two regions — which is how facilitators actually run. The F2 race the
// paper reproduces on Base is a race between MACHINES, and defending it in one
// process is defending the wrong thing.
//
// Each operation below is a single Redis round trip whose atomicity is Redis's,
// not ours: either one command that is natively atomic (`SET NX`), or one Lua
// script, which Redis executes to completion without interleaving.
//
// STILL ZERO DEPENDENCIES. The client is injected, not imported. Anything that
// can send one Redis command and return its reply works — Upstash's REST
// endpoint, ioredis, node-redis. Adapters for all three are at the bottom; a
// fourth is three lines.
//
// PRECISION BOUND. Redis Lua numbers are IEEE doubles, so integer arithmetic
// inside a script is exact only below 2^53. Allowance amounts are checked
// against that ceiling and rejected above it rather than silently rounded. For
// 6-decimal USDC this permits balances up to ~9.0 billion, which is well past
// any real allowance; anything larger needs a bigint-safe backend, and failing
// loudly is the only honest option.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import type { AllowanceStore, CapacityLimiter, CapacityRelease, NonceStore, NonceState } from "./index.js";

/**
 * The whole client contract: issue one Redis command, get its reply.
 *
 * Deliberately the Upstash REST shape (`["SET", key, value, "NX"]`) because it
 * is the lowest common denominator every client can express, and because it
 * needs no SDK at all — a `fetch` satisfies it.
 */
export interface RedisCommandClient {
  command(args: (string | number)[]): Promise<unknown>;
}

/** Lua's exact-integer ceiling. Amounts at or above this are refused. */
export const MAX_SAFE_AMOUNT = 9_007_199_254_740_991n; // 2^53 - 1

function assertSafeAmount(value: bigint, label: string): void {
  if (value > MAX_SAFE_AMOUNT) {
    throw new RangeError(
      `${label} exceeds the Lua exact-integer ceiling (2^53-1); use a bigint-safe backend`
    );
  }
}

// ── F2: nonce linearization across processes ───────────────────────────────

const RELEASE_IF_PENDING = `
if redis.call('GET', KEYS[1]) == 'pending' then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * The Lua this module runs, exported so tests can address the scripts by their
 * exact text. Test doubles key off a HASH of these strings rather than the
 * strings themselves: editing the Lua then changes the hash and the double
 * fails loudly, instead of quietly continuing to exercise a stale stand-in.
 */
export const SCRIPTS = Object.freeze({
  releaseIfPending: RELEASE_IF_PENDING,
  get reserve() {
    return RESERVE;
  },
  get commit() {
    return COMMIT;
  },
  get reserveCapacity() {
    return RESERVE_CAPACITY;
  },
});

/**
 * NonceStore on Redis. `acquire` is `SET key pending NX`, which is atomic in
 * Redis itself — exactly one caller across the whole fleet receives OK.
 *
 * `release` is a compare-and-delete rather than a plain DEL. A stray release
 * arriving after the nonce reached SETTLED would reopen a spent authorization
 * for replay, which is the precise hole the paper documents; a DEL cannot tell
 * the two states apart, so the check and the delete have to be one script.
 *
 * TTL. A PENDING nonce whose owner crashed before resolving would otherwise
 * block that authorization forever. The TTL bounds it, and MUST be set well
 * beyond the longest settlement a chain can take: expiring a PENDING nonce
 * while its transaction is still in flight re-opens the replay window. Default
 * is 24h, deliberately generous.
 */
export class RedisNonceStore implements NonceStore {
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly client: RedisCommandClient,
    opts: { prefix?: string; ttlSeconds?: number } = {}
  ) {
    this.prefix = opts.prefix ?? "x402g:nonce:";
    this.ttlSeconds = opts.ttlSeconds ?? 86_400;
    if (!Number.isInteger(this.ttlSeconds) || this.ttlSeconds < 1) {
      throw new RangeError("ttlSeconds must be a positive integer");
    }
  }

  private key(nonce: string): string {
    return `${this.prefix}${nonce}`;
  }

  async acquire(nonce: string): Promise<boolean> {
    const reply = await this.client.command(["SET", this.key(nonce), "pending", "NX", "EX", this.ttlSeconds]);
    // Upstash returns "OK", ioredis returns "OK", both return null on a miss.
    return reply !== null && reply !== undefined;
  }

  async markSettled(nonce: string): Promise<void> {
    // Unconditional: only the caller holding the claim reaches this, and
    // SETTLED is terminal, so there is nothing to compare against.
    await this.client.command(["SET", this.key(nonce), "settled", "EX", this.ttlSeconds]);
  }

  async release(nonce: string): Promise<void> {
    await this.client.command(["EVAL", RELEASE_IF_PENDING, 1, this.key(nonce)]);
  }

  async state(nonce: string): Promise<NonceState | undefined> {
    const reply = await this.client.command(["GET", this.key(nonce)]);
    return reply === "pending" || reply === "settled" ? reply : undefined;
  }
}

// ── F3: allowance reserve-commit across processes ──────────────────────────

// Conditional decrement. The read and the write are one script, which is the
// entire difference between this and the read-then-deduct overdraft.
const RESERVE = `
local bal = redis.call('GET', KEYS[1])
if not bal then return 0 end
local remaining = tonumber(bal)
local vmax = tonumber(ARGV[1])
if vmax <= 0 or remaining < vmax then return 0 end
redis.call('SET', KEYS[1], tostring(remaining - vmax))
redis.call('HSET', KEYS[2], 'allowance', KEYS[1], 'amount', ARGV[1])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2]))
return 1`;

// Bill the actual amount, clamped to the escrow, and refund the rest. Deleting
// the reservation first makes a double-commit a no-op returning 0.
const COMMIT = `
local amount = redis.call('HGET', KEYS[2], 'amount')
if not amount then return '0' end
redis.call('DEL', KEYS[2])
local reserved = tonumber(amount)
local actual = tonumber(ARGV[1])
if actual < 0 then actual = 0 end
if actual > reserved then actual = reserved end
local refund = reserved - actual
if refund > 0 then
  local bal = tonumber(redis.call('GET', KEYS[1]) or '0')
  redis.call('SET', KEYS[1], tostring(bal + refund))
end
return tostring(actual)`;

/**
 * AllowanceStore on Redis.
 *
 * Reservation ids embed their allowance id so `commit` can name BOTH keys in
 * the script's KEYS array. Deriving the allowance key inside Lua instead would
 * work on a single node and break on Redis Cluster, where every key a script
 * touches must be declared. Both keys also carry a `{hash tag}` so the cluster
 * maps them to the same slot.
 */
export class RedisAllowanceStore implements AllowanceStore {
  private readonly prefix: string;
  private readonly reservationTtlSeconds: number;

  constructor(
    private readonly client: RedisCommandClient,
    opts: { prefix?: string; reservationTtlSeconds?: number } = {}
  ) {
    this.prefix = opts.prefix ?? "x402g:";
    this.reservationTtlSeconds = opts.reservationTtlSeconds ?? 3_600;
  }

  private balanceKey(allowanceId: string): string {
    return `${this.prefix}alw:{${allowanceId}}`;
  }

  private reservationKey(allowanceId: string, token: string): string {
    return `${this.prefix}res:{${allowanceId}}:${token}`;
  }

  /** `<allowanceId>::<token>` — split on the LAST separator so ids may contain it. */
  private parseReservation(reservationId: string): { allowanceId: string; token: string } | null {
    const at = reservationId.lastIndexOf("::");
    if (at <= 0) return null;
    return { allowanceId: reservationId.slice(0, at), token: reservationId.slice(at + 2) };
  }

  /** Register a signed `upto` allowance. */
  async create(allowanceId: string, total: bigint): Promise<void> {
    if (total < 0n) throw new RangeError("allowance total must be non-negative");
    assertSafeAmount(total, "allowance total");
    await this.client.command(["SET", this.balanceKey(allowanceId), total.toString()]);
  }

  async reserve(allowanceId: string, vmax: bigint): Promise<string | null> {
    if (vmax <= 0n) return null;
    assertSafeAmount(vmax, "vmax");
    const token = crypto.randomUUID().replace(/-/g, "");
    const reply = await this.client.command([
      "EVAL",
      RESERVE,
      2,
      this.balanceKey(allowanceId),
      this.reservationKey(allowanceId, token),
      vmax.toString(),
      this.reservationTtlSeconds,
    ]);
    return Number(reply) === 1 ? `${allowanceId}::${token}` : null;
  }

  async commit(reservationId: string, actual: bigint): Promise<bigint> {
    const parsed = this.parseReservation(reservationId);
    if (!parsed) return 0n;
    const clamped = actual < 0n ? 0n : actual;
    assertSafeAmount(clamped, "actual");
    const reply = await this.client.command([
      "EVAL",
      COMMIT,
      2,
      this.balanceKey(parsed.allowanceId),
      this.reservationKey(parsed.allowanceId, parsed.token),
      clamped.toString(),
    ]);
    return BigInt(String(reply ?? "0"));
  }

  async release(reservationId: string): Promise<void> {
    await this.commit(reservationId, 0n);
  }

  async remaining(allowanceId: string): Promise<bigint | undefined> {
    const reply = await this.client.command(["GET", this.balanceKey(allowanceId)]);
    return reply === null || reply === undefined ? undefined : BigInt(String(reply));
  }
}

// ── F4: settlement capacity across processes ───────────────────────────────

// Sorted set keyed by lease timestamp. Expiring stale holders before counting
// is what makes this survive a crashed worker.
const RESERVE_CAPACITY = `
local now = tonumber(ARGV[1])
local leaseMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - leaseMs)
if redis.call('ZCARD', KEYS[1]) >= max then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], leaseMs * 2)
return 1`;

/**
 * SettlementCapacityLimiter on Redis.
 *
 * A counter incremented on reserve and decremented on release would be simpler
 * and wrong: a worker that dies holding a slot leaks it permanently, and a
 * facilitator that slowly loses capacity to crashed workers ends up refusing
 * all traffic — the denial-of-settlement outcome, self-inflicted.
 *
 * Holders are entries in a sorted set scored by acquisition time, and each
 * reservation first evicts anything older than the lease. A crashed worker's
 * slot is reclaimed automatically once its lease expires. Set `leaseMs` above
 * the longest settlement you expect: too short double-issues a slot, too long
 * just delays reclamation, so err high.
 */
export class RedisSettlementCapacityLimiter implements CapacityLimiter {
  private readonly key: string;
  private readonly leaseMs: number;

  constructor(
    private readonly client: RedisCommandClient,
    private readonly maxConcurrent: number,
    opts: { key?: string; leaseMs?: number } = {}
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a positive integer");
    }
    this.key = opts.key ?? "x402g:capacity";
    this.leaseMs = opts.leaseMs ?? 60_000;
    if (!Number.isInteger(this.leaseMs) || this.leaseMs < 1) {
      throw new RangeError("leaseMs must be a positive integer");
    }
  }

  async tryReserve(): Promise<CapacityRelease | null> {
    const token = crypto.randomUUID();
    const reply = await this.client.command([
      "EVAL",
      RESERVE_CAPACITY,
      1,
      this.key,
      Date.now(),
      this.leaseMs,
      this.maxConcurrent,
      token,
    ]);
    if (Number(reply) !== 1) return null;

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.client.command(["ZREM", this.key, token]);
    };
  }

  /** Live holder count, after evicting expired leases. Diagnostics only. */
  async inFlight(): Promise<number> {
    await this.client.command(["ZREMRANGEBYSCORE", this.key, "-inf", Date.now() - this.leaseMs]);
    return Number(await this.client.command(["ZCARD", this.key]));
  }
}

// ── Client adapters ────────────────────────────────────────────────────────

/**
 * Upstash Redis REST — no SDK, just `fetch`. This is the shape the rest of
 * FurlPay already uses, and it works on Edge runtimes where a TCP client cannot.
 */
export function fromUpstashRest(url: string, token: string): RedisCommandClient {
  return {
    async command(args) {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`redis http ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { result?: unknown; error?: string };
      if (data.error) throw new Error(`redis: ${data.error}`);
      return data.result ?? null;
    },
  };
}

/** ioredis (or any client exposing a variadic `call`). */
export function fromIoRedis(client: { call: (...args: (string | number)[]) => Promise<unknown> }): RedisCommandClient {
  return { command: (args) => client.call(...args) };
}

/** node-redis v4+ (`sendCommand` takes an array of strings). */
export function fromNodeRedis(client: { sendCommand: (args: string[]) => Promise<unknown> }): RedisCommandClient {
  return { command: (args) => client.sendCommand(args.map(String)) };
}
