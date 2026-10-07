// ---------------------------------------------------------------------------
// Durable key-value layer for state that must survive serverless instances
// (card-auth challenges, push subscriptions, webhook dedup).
//
// Backend selection, in order:
//   1. Upstash Redis REST (UPSTASH_REDIS_REST_URL/TOKEN — also set by the
//      Vercel Marketplace as KV_REST_API_URL/KV_REST_API_TOKEN). Plain fetch,
//      no SDK dependency, works on Node and Edge runtimes.
//   2. Bounded in-memory store with real TTL semantics — dev/demo fallback.
//      Correct on a single instance; production MUST configure Redis, since
//      a challenge written by one lambda has to be readable by the next.
//
// Values are JSON. TTLs are enforced by Redis (EX) or checked on read.
// ---------------------------------------------------------------------------

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const kvBackend: "redis" | "memory" = REST_URL && REST_TOKEN ? "redis" : "memory";

// --- Redis (Upstash REST protocol: POST /  ["CMD", ...args]) ---------------

// --- Failure classification ----------------------------------------------
//
// "Redis is down" is several different incidents with different owners. On
// 2026-10-02 every command returned 403 "This database has reached current
// Fixed plan limits" — a billing action, not a network one — and it was
// indistinguishable in logs from an outage. Upstash reports which quota was
// hit in the error text when it knows; a generic plan-limit message is kept
// as its own category rather than guessed into one of the specific ones.

export type KvErrorCategory =
  | "timeout"
  | "auth"
  | "request_limit"
  | "bandwidth_limit"
  | "storage_limit"
  | "plan_limit"
  | "throttled"
  | "network"
  | "unknown";

export class KvError extends Error {
  readonly category: KvErrorCategory;
  readonly httpStatus: number | null;
  constructor(message: string, category: KvErrorCategory, httpStatus: number | null) {
    super(message);
    this.name = "KvError";
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

/** Pure, so it can be tested against the provider's real messages. */
export function classifyKvFailure(httpStatus: number | null, text: string): KvErrorCategory {
  const t = text.toLowerCase();
  if (httpStatus === 401 || /wrongpass|unauthori[sz]ed|invalid (api )?token|noauth/.test(t)) return "auth";
  if (/bandwidth/.test(t)) return "bandwidth_limit";
  if (/(max|db|database|data)[ _-]?(size|storage)|storage limit|disk/.test(t)) return "storage_limit";
  if (/request(s)? limit|max (daily |monthly )?requests?|commands? limit/.test(t)) return "request_limit";
  if (/plan limit/.test(t)) return "plan_limit";
  if (httpStatus === 429 || /too many requests|throttl|rate limit/.test(t)) return "throttled";
  return "unknown";
}

/** Category of any error thrown by this module; "unknown" for anything else. */
export function kvErrorCategory(e: unknown): KvErrorCategory {
  return e instanceof KvError ? e.category : "unknown";
}

/** Bounded, so a hung Redis cannot hang every request that touches state. */
const KV_TIMEOUT_MS = 5_000;

async function redis(command: (string | number)[]): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(REST_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(KV_TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    throw new KvError(
      timedOut ? `kv redis timeout after ${KV_TIMEOUT_MS}ms` : `kv redis network error: ${(e as Error)?.message ?? e}`,
      timedOut ? "timeout" : "network",
      null
    );
  }
  if (!res.ok) {
    // The body is the provider's error text — it never echoes our command or
    // the token — but it is bounded anyway.
    const body = (await res.text()).slice(0, 300);
    throw new KvError(`kv redis error ${res.status}: ${body}`, classifyKvFailure(res.status, body), res.status);
  }
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) {
    throw new KvError(`kv redis error: ${data.error.slice(0, 300)}`, classifyKvFailure(res.status, data.error), res.status);
  }
  return data.result;
}

// --- In-memory fallback ------------------------------------------------------

interface MemEntry {
  value: string;
  expiresAt: number; // epoch ms; Infinity = no TTL
}

const MAX_MEM_KEYS = 50_000;
const g = globalThis as unknown as { __furlpayKv?: Map<string, MemEntry> };
const mem = (): Map<string, MemEntry> => (g.__furlpayKv ??= new Map());

/**
 * Refuse the in-memory fallback in production.
 *
 * The fallback is correct on ONE instance. In production this layer carries
 * webhook dedup, card-auth challenges and rate limits — all of which are
 * cross-instance invariants. Serving them from per-lambda memory does not
 * error; it silently returns "no previous record", which means a replayed
 * webhook looks new and a rate limit resets on every cold start.
 *
 * Losing UPSTASH_REDIS_REST_URL/TOKEN is a plausible config mistake, and the
 * old behaviour made it INVISIBLE. Failing here is loud, and — unlike a
 * module-load throw, which would take the whole deployment down on import —
 * it fails only the operations whose correctness actually depends on Redis.
 */
function assertDurableBackend(op: string): void {
  if (kvBackend === "memory" && process.env.NODE_ENV === "production") {
    throw new Error(
      `kv.${op}: refusing the in-memory fallback in production. ` +
        `Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or the ` +
        `KV_REST_API_* aliases). Webhook dedup, auth challenges and rate ` +
        `limits are cross-instance and cannot be served from lambda memory.`
    );
  }
}

function memGet(key: string): string | null {
  const e = mem().get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    mem().delete(key);
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlSeconds?: number): void {
  const store = mem();
  store.delete(key); // re-insert so Map order tracks recency for eviction
  store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity });
  while (store.size > MAX_MEM_KEYS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

// --- Public API --------------------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  if (kvBackend !== "redis") assertDurableBackend("get");
  const raw = kvBackend === "redis" ? ((await redis(["GET", key])) as string | null) : memGet(key);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (kvBackend === "redis") {
    await redis(ttlSeconds ? ["SET", key, raw, "EX", ttlSeconds] : ["SET", key, raw]);
  } else {
    assertDurableBackend("set");
    memSet(key, raw, ttlSeconds);
  }
}

export async function kvDel(key: string): Promise<void> {
  if (kvBackend === "redis") await redis(["DEL", key]);
  else {
    assertDurableBackend("del");
    mem().delete(key);
  }
}

/** Atomic set-if-absent — the primitive behind cross-instance webhook dedup.
 *  Returns true when this caller won the key. */
export async function kvSetNx(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const raw = JSON.stringify(value);
  if (kvBackend === "redis") {
    const result = await redis(["SET", key, raw, "NX", "EX", ttlSeconds]);
    return result === "OK";
  }
  assertDurableBackend("setNx");
  if (memGet(key) !== null) return false;
  memSet(key, raw, ttlSeconds);
  return true;
}

// INCRBY and its window TTL in ONE atomic step. The previous INCR-then-EXPIRE
// pair was two requests: when the EXPIRE failed (timeout, plan limit), the
// counter lived forever, a slow leak of keys that never expire on a store
// whose plan limit took production down on 7 Oct 2026. The TTL is (re)armed
// whenever the key has none, which also heals counters leaked before this
// change, and a new window costs one request instead of two.
const INCR_WITH_TTL =
  "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end return v";

/** Atomic counter with a fixed-window TTL — the rate-limit primitive.
 *  Returns the count within the current window. */
export async function kvIncr(key: string, windowSeconds: number): Promise<number> {
  if (kvBackend === "redis") {
    return Number(await redis(["EVAL", INCR_WITH_TTL, 1, key, 1, windowSeconds]));
  }
  assertDurableBackend("incr");
  const current = Number(memGet(key) ?? 0) + 1;
  // Preserve the window: only (re)set the TTL when the window opens.
  if (current === 1) memSet(key, String(current), windowSeconds);
  else {
    const entry = mem().get(key)!;
    entry.value = String(current);
  }
  return current;
}

/** Atomic add-by-amount with a fixed-window TTL — the spend-velocity
 *  primitive. Integer amounts only (store money as cents). Returns the
 *  window's running total. */
export async function kvIncrBy(key: string, by: number, windowSeconds: number): Promise<number> {
  const amount = Math.round(by);
  if (kvBackend === "redis") {
    return Number(await redis(["EVAL", INCR_WITH_TTL, 1, key, amount, windowSeconds]));
  }
  assertDurableBackend("incrBy");
  const current = Number(memGet(key) ?? 0) + amount;
  if (current === amount) memSet(key, String(current), windowSeconds);
  else {
    const entry = mem().get(key)!;
    entry.value = String(current);
  }
  return current;
}

/** Integer counters for many keys in ONE round trip (MGET); a missing key is 0.
 *  For reading the time-bucketed counters kvIncrBy writes. */
export async function kvMGetCounts(keys: string[]): Promise<number[]> {
  if (keys.length === 0) return [];
  if (kvBackend === "redis") {
    const out: number[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const vals = ((await redis(["MGET", ...chunk])) as (string | null)[]) ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const n = Number(vals[j] ?? 0);
        out.push(Number.isFinite(n) ? n : 0);
      }
    }
    return out;
  }
  assertDurableBackend("mget");
  return keys.map((k) => {
    const n = Number(memGet(k) ?? 0);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Prepend to a bounded list (LPUSH + LTRIM) — newest first. */
export async function kvListPush(key: string, value: string, maxLength: number): Promise<void> {
  if (kvBackend === "redis") {
    await redis(["LPUSH", key, value]);
    await redis(["LTRIM", key, 0, maxLength - 1]);
    return;
  }
  assertDurableBackend("listPush");
  const list: string[] = JSON.parse(memGet(key) ?? "[]");
  list.unshift(value);
  memSet(key, JSON.stringify(list.slice(0, maxLength)));
}

/** Read the first `count` entries of a list (newest first). */
export async function kvListRange(key: string, count: number): Promise<string[]> {
  if (kvBackend === "redis") {
    return ((await redis(["LRANGE", key, 0, count - 1])) as string[]) ?? [];
  }
  const list: string[] = JSON.parse(memGet(key) ?? "[]");
  return list.slice(0, count);
}

// --- Sorted sets -------------------------------------------------------------
//
// Added for the price-alert matching engine (lib/alerts/userAlerts.ts), and the
// reason it needs a sorted set rather than a list is complexity. Evaluating every
// stored alert against every incoming tick is O(N) per tick — at 10k alerts and a
// few ticks a second that is a scan per tick, and the cost grows with the number
// of users rather than with the number of alerts that actually fired.
//
// A sorted set scored by target price turns the question "which alerts does this
// price cross?" into a range read: O(log N + M), where M is the number that
// genuinely triggered. The work becomes proportional to the ANSWER, not the data.
//
// THE MEMORY FALLBACK IS A REAL SORTED SET, not an approximation. It has to be:
// these are the semantics the engine's correctness rests on, and a fallback that
// merely looks similar would pass tests on one instance and misfire in
// production. Members are unique (a re-add updates the score, as ZADD does), and
// range reads are inclusive of both bounds, matching Redis.

interface MemZMember {
  member: string;
  score: number;
}

function memZRead(key: string): MemZMember[] {
  return JSON.parse(memGet(key) ?? "[]") as MemZMember[];
}

function memZWrite(key: string, members: MemZMember[]): void {
  // Kept sorted by score so a range read is a filter rather than a sort, and so
  // the stored shape matches what a reader expects without re-deriving it.
  members.sort((a, b) => (a.score === b.score ? a.member.localeCompare(b.member) : a.score - b.score));
  memSet(key, JSON.stringify(members));
}

/**
 * Add or update a member's score (ZADD).
 *
 * Re-adding an existing member UPDATES its score rather than duplicating it,
 * which is what makes "move this alert's target price" a single call.
 */
export async function kvZAdd(key: string, score: number, member: string): Promise<void> {
  if (kvBackend === "redis") {
    await redis(["ZADD", key, score, member]);
    return;
  }
  assertDurableBackend("zAdd");
  const members = memZRead(key).filter((m) => m.member !== member);
  members.push({ member, score });
  memZWrite(key, members);
}

/**
 * Members whose score falls in [min, max], inclusive (ZRANGEBYSCORE).
 *
 * `min`/`max` accept Redis's infinity tokens, which the matching engine relies
 * on: "every alert at or below this price" is `["-inf", price]`.
 */
export async function kvZRangeByScore(
  key: string,
  min: number | "-inf",
  max: number | "+inf"
): Promise<string[]> {
  if (kvBackend === "redis") {
    return ((await redis(["ZRANGEBYSCORE", key, String(min), String(max)])) as string[]) ?? [];
  }
  const lo = min === "-inf" ? Number.NEGATIVE_INFINITY : min;
  const hi = max === "+inf" ? Number.POSITIVE_INFINITY : max;
  return memZRead(key)
    .filter((m) => m.score >= lo && m.score <= hi)
    .map((m) => m.member);
}

/** Remove members (ZREM). Returns how many were actually removed. */
export async function kvZRem(key: string, members: string[]): Promise<number> {
  if (members.length === 0) return 0;
  if (kvBackend === "redis") {
    return ((await redis(["ZREM", key, ...members])) as number) ?? 0;
  }
  assertDurableBackend("zRem");
  const before = memZRead(key);
  const drop = new Set(members);
  const after = before.filter((m) => !drop.has(m.member));
  memZWrite(key, after);
  return before.length - after.length;
}

/** Number of members in the set (ZCARD). Used for per-user alert quotas. */
export async function kvZCard(key: string): Promise<number> {
  if (kvBackend === "redis") {
    return ((await redis(["ZCARD", key])) as number) ?? 0;
  }
  return memZRead(key).length;
}

/** A member's score, or null if absent (ZSCORE). */
export async function kvZScore(key: string, member: string): Promise<number | null> {
  if (kvBackend === "redis") {
    const v = await redis(["ZSCORE", key, member]);
    return v === null || v === undefined ? null : Number(v);
  }
  return memZRead(key).find((m) => m.member === member)?.score ?? null;
}

// --- HyperLogLog ------------------------------------------------------------
//
// Used for DAU/MAU counting (unique-user approximation). Redis HyperLogLog
// gives ~0.81 % error at 12 KB per key — perfect for cardinality estimates
// that don't need exact counts.

/**
 * PFADD: add members to a HyperLogLog (approximate distinct counting).
 * \`ttlSeconds\` (optional) bounds retention; it is set only when the key is new.
 */
export async function kvPfAdd(key: string, ...members: string[]): Promise<number> {
  return kvPfAddTtl(key, undefined, ...members);
}

export async function kvPfAddTtl(key: string, ttlSeconds: number | undefined, ...members: string[]): Promise<number> {
  if (members.length === 0) return 0;
  if (kvBackend === "redis") {
    const changed = (await redis(["PFADD", key, ...members])) as number;
    // Plain EXPIRE (no NX, which needs Redis 7): callers use per-day keys, so
    // re-arming on each write moves the expiry by less than a day.
    if (ttlSeconds) await redis(["EXPIRE", key, ttlSeconds]);
    return changed;
  }
  assertDurableBackend("pfAdd");
  // In-memory fallback: an exact Set (dev only).
  const existing = memGet(key);
  const set: Set<string> = existing ? new Set(JSON.parse(existing) as string[]) : new Set();
  let added = 0;
  for (const m of members) {
    if (!set.has(m)) { set.add(m); added++; }
  }
  memSet(key, JSON.stringify([...set]), existing ? undefined : ttlSeconds);
  return added > 0 ? 1 : 0;
}

/**
 * PFCOUNT: approximate cardinality. Several keys give the cardinality of their
 * UNION, i.e. distinct members across days, not a sum of daily counts.
 */
export async function kvPfCount(...keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  if (kvBackend === "redis") {
    return (await redis(["PFCOUNT", ...keys])) as number;
  }
  assertDurableBackend("pfCount");
  const union = new Set<string>();
  for (const k of keys) {
    const existing = memGet(k);
    if (existing) for (const m of JSON.parse(existing) as string[]) union.add(m);
  }
  return union.size;
}
