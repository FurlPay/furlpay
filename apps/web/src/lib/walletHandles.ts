// ---------------------------------------------------------------------------
// FurlPay Wallet handle rules — the single source of truth shared by the
// availability check (GET /api/check) and the reservation (POST
// /api/wallet/reserve). Keeping normalization and the reserved list here means
// the two endpoints can never disagree about what a name resolves to.
//
// Reservations are durable KV entries (lib/kv.ts). `kvSetNx` makes claiming a
// handle atomic and first-come-first-served, so two people submitting the same
// name in the same instant cannot both win it.
// ---------------------------------------------------------------------------

import { kvGet, kvSet, kvSetNx } from "@/lib/kv";

/** Read scopes the wallet reservation grants when a user authorizes it. These
 *  are the real FurlPay OAuth read scopes (see lib/mcp/oauth.ts SCOPES) — the
 *  consent screen spells each out in plain language. Read-only by design: a
 *  handle reservation never grants the ability to move money. */
export const WALLET_GRANT_SCOPES = ["profile:read", "wallets:read", "transactions:read"] as const;
export type WalletScope = (typeof WALLET_GRANT_SCOPES)[number];

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;
const HANDLE_RE = /^[a-z0-9-]+$/;

// Names we will not hand out: brand/system terms, routing words, and anything
// that could impersonate FurlPay itself or a support channel.
const RESERVED = new Set([
  "furlpay",
  "furl",
  "pay",
  "wallet",
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "security",
  "abuse",
  "billing",
  "api",
  "www",
  "app",
  "mail",
  "smtp",
  "official",
  "team",
  "staff",
  "moderator",
  "mod",
  "system",
  "null",
  "undefined",
]);

const KEY = (handle: string) => `wallet:handle:${handle}`;

export interface HandleValidation {
  ok: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Normalize and validate a requested handle. Normalization is a trim +
 * lowercase; the pattern then rejects anything outside `[a-z0-9-]`. A leading
 * or trailing hyphen is rejected so handles read cleanly as subdomains.
 */
export function normalizeHandle(input: unknown): HandleValidation {
  if (typeof input !== "string") {
    return { ok: false, error: "A wallet name is required." };
  }
  const normalized = input.trim().toLowerCase();

  if (normalized.length < HANDLE_MIN) {
    return { ok: false, error: `At least ${HANDLE_MIN} characters.` };
  }
  if (normalized.length > HANDLE_MAX) {
    return { ok: false, error: `At most ${HANDLE_MAX} characters.` };
  }
  if (!HANDLE_RE.test(normalized)) {
    return { ok: false, error: "Letters, numbers and hyphens only." };
  }
  if (normalized.startsWith("-") || normalized.endsWith("-")) {
    return { ok: false, error: "Cannot start or end with a hyphen." };
  }
  if (RESERVED.has(normalized)) {
    return { ok: false, error: "That name is reserved." };
  }
  return { ok: true, normalized };
}

const HANDLE_TTL = 60 * 60 * 24 * 90; // 90 days — comfortably covers the launch window

interface HandleRecord {
  reservedAt: number;
  /** The FurlPay user id that owns (claimed) this handle. */
  ownerId: string;
  /** Read scopes granted at consent time. */
  scopes: string[];
  consentAt: number;
  /** null when the client IP could not be established (lib/clientIp.ts). */
  ip: string | null;
}

/** True when the (already-normalized) handle has not been reserved yet. */
export async function isHandleAvailable(normalized: string): Promise<boolean> {
  const existing = await kvGet<HandleRecord>(KEY(normalized));
  return existing === null;
}

/** The owner record for a handle, or null if unreserved. */
export async function getHandle(normalized: string): Promise<HandleRecord | null> {
  return kvGet<HandleRecord>(KEY(normalized));
}

/**
 * Atomically bind a handle to a FurlPay account at consent time.
 *
 * The common path is a single atomic `kvSetNx`: the first authenticated user to
 * reach an unreserved handle owns it, and a concurrent request for the same
 * name loses cleanly. Re-authorizing your own handle is idempotent (returns
 * ok). A handle already owned by a different account returns `taken` — a
 * reservation belongs to exactly one account.
 */
export async function bindHandleToUser(input: {
  normalized: string;
  userId: string;
  scopes: readonly string[];
  ip: string | null;
}): Promise<{ ok: true } | { ok: false; error: "taken" }> {
  const key = KEY(input.normalized);
  const record: HandleRecord = {
    reservedAt: Date.now(),
    ownerId: input.userId,
    scopes: [...input.scopes],
    consentAt: Date.now(),
    ip: input.ip,
  };

  // Fast path: claim an unreserved handle atomically.
  if (await kvSetNx(key, record, HANDLE_TTL)) return { ok: true };

  // Already exists: only the owning account may (re)write it.
  const existing = await getHandle(input.normalized);
  if (!existing) {
    // Vanished between the SETNX and the GET (TTL/eviction) — retry the claim.
    return (await kvSetNx(key, record, HANDLE_TTL)) ? { ok: true } : { ok: false, error: "taken" };
  }
  if (existing.ownerId && existing.ownerId !== input.userId) {
    return { ok: false, error: "taken" };
  }
  // Owned by this same user (or a legacy unowned entry) — refresh consent.
  await kvSet(key, { ...existing, ...record }, HANDLE_TTL);
  return { ok: true };
}
