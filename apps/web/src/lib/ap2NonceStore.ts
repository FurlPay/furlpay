import { createHash } from "node:crypto";
import type { NonceStore, NonceKind } from "@furlpay/ap2";
import { kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Durable single-use store for AP2 mandate nonces (audit F-13).
//
// /api/agents/ap2 used `memoryNonceStore()` — a Set per serverless instance.
// A single-use IntentMandate presented to a second instance was accepted
// again, so one user consent could yield several settlement requests.
//
// Every claim is now one Redis SET NX (lib/kv.ts), which linearizes it across
// instances. The record lives until the mandate expires, so a nonce cannot be
// replayed while the mandate it belongs to is still valid. kv refuses its
// in-memory fallback in production and throws on any Redis failure, so an
// unreachable store refuses the authorization; it never degrades to
// per-instance memory.
// ---------------------------------------------------------------------------

/** Longest intent validity the route accepts. A claim record must outlive the
 *  mandate it protects; mandates beyond this are refused, not truncated. */
export const AP2_MAX_VALIDITY_MS = 30 * 86_400_000;

const SLACK_SECONDS = 300;

/** Nonces are mandate-chosen text; hash them so key length and charset are
 *  ours. Namespaced by kind so a cart nonce can never satisfy an intent claim. */
export function ap2NonceKey(kind: NonceKind, nonce: string): string {
  return `ap2:nonce:${kind}:${createHash("sha256").update(nonce).digest("hex")}`;
}

export function ap2ClaimTtlSeconds(expiresAt: number, now = Date.now()): number {
  return Math.max(60, Math.ceil((expiresAt - now) / 1000) + SLACK_SECONDS);
}

export function durableAp2NonceStore(): NonceStore {
  const refuse = () => {
    throw new Error("ap2 nonce store is claim-only");
  };
  return {
    // authorizeCart uses claim() whenever it exists; has/add exist only to
    // satisfy the interface and refuse loudly if anything calls them.
    has: refuse,
    add: refuse,
    claim: (kind, nonce, expiresAt) => kvSetNx(ap2NonceKey(kind, nonce), Date.now(), ap2ClaimTtlSeconds(expiresAt)),
  };
}
