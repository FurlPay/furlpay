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

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv redis error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(`kv redis error: ${data.error}`);
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
    memSet(key, raw, ttlSeconds);
  }
}

export async function kvDel(key: string): Promise<void> {
  if (kvBackend === "redis") await redis(["DEL", key]);
  else mem().delete(key);
}

/** Atomic set-if-absent — the primitive behind cross-instance webhook dedup.
 *  Returns true when this caller won the key. */
export async function kvSetNx(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const raw = JSON.stringify(value);
  if (kvBackend === "redis") {
    const result = await redis(["SET", key, raw, "NX", "EX", ttlSeconds]);
    return result === "OK";
  }
  if (memGet(key) !== null) return false;
  memSet(key, raw, ttlSeconds);
  return true;
}

/** Atomic counter with a fixed-window TTL — the rate-limit primitive.
 *  Returns the count within the current window. */
export async function kvIncr(key: string, windowSeconds: number): Promise<number> {
  if (kvBackend === "redis") {
    const count = (await redis(["INCR", key])) as number;
    if (count === 1) await redis(["EXPIRE", key, windowSeconds]);
    return count;
  }
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
    const total = (await redis(["INCRBY", key, amount])) as number;
    if (total === amount) await redis(["EXPIRE", key, windowSeconds]);
    return total;
  }
  const current = Number(memGet(key) ?? 0) + amount;
  if (current === amount) memSet(key, String(current), windowSeconds);
  else {
    const entry = mem().get(key)!;
    entry.value = String(current);
  }
  return current;
}

/** Prepend to a bounded list (LPUSH + LTRIM) — newest first. */
export async function kvListPush(key: string, value: string, maxLength: number): Promise<void> {
  if (kvBackend === "redis") {
    await redis(["LPUSH", key, value]);
    await redis(["LTRIM", key, 0, maxLength - 1]);
    return;
  }
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
