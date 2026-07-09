// Distributed mutex on the KV layer (`lock:{name}`). Prevents two serverless
// instances from executing the same critical section — the canonical case is
// a double-clicked "Confirm booking" landing on two lambdas at once.

import crypto from "crypto";
import { kvBackend, kvSetNx, kvGet, kvDel } from "./kv";

const KEY = (name: string) => `lock:${name}`;

/**
 * Try to acquire `name` for ttlSeconds. Returns a release token, or null when
 * another holder owns the lock (caller should treat the operation as already
 * in flight).
 */
export async function acquireLock(name: string, ttlSeconds = 30): Promise<string | null> {
  const token = crypto.randomUUID();
  const won = await kvSetNx(KEY(name), token, ttlSeconds);
  return won ? token : null;
}

/**
 * Release a held lock. Only deletes when the stored token matches — a holder
 * whose TTL already expired can't stomp the next holder's lock. (Redis path
 * is check-and-delete via EVAL, atomic server-side.)
 */
export async function releaseLock(name: string, token: string): Promise<void> {
  if (kvBackend === "redis") {
    const script =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const auth = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    await fetch(url!, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", script, 1, KEY(name), JSON.stringify(token)]),
      cache: "no-store",
    }).catch(() => undefined); // lock has a TTL — a failed release just expires naturally
    return;
  }
  const held = await kvGet<string>(KEY(name));
  if (held === token) await kvDel(KEY(name));
}
