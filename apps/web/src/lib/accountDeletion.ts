import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { evictAccount, getAccount, DEMO_USER_ID, type UserAccount } from "@/lib/store";
import { deleteAccount as dbDeleteAccount } from "@/lib/storeDb";
import { supabaseBackend } from "@/lib/supabase";
import { listAgentKeys, revokeAgentKey } from "@/lib/agentPolicy";

// ---------------------------------------------------------------------------
// Account deletion (Google Play "delete account" requirement + GDPR erasure).
//
// RETENTION MODEL — inherited from the schema, not invented here. Migration
// 0002 states the policy outright: "GDPR erasure removes the user row, not the
// evidence that actions happened." So:
//
//   ERASED (on delete cascade from users):
//     token_balances, fiat_balances, holdings, cards, bills, transactions,
//     trips, linked_wallets  — plus the users row itself (name, email, phone,
//     googleSub/appleSub, security JSONB incl. totpSecret, notification prefs).
//
//   PSEUDONYMIZED (on delete set null):
//     deposits.user_id — the on-chain deposit ledger is the "permanent record"
//     (0002). The row survives; the subject is detached.
//
//   RETAINED (no foreign key, deliberately):
//     audit_log, ops_tx_events, ops_security_events — the security/compliance
//     trail. Deleting a user must not erase the evidence that they acted.
//
// This module does NOT invent a retention period. It does not decide that
// financial records are kept for N years; it executes the split the schema
// already encodes and reports it honestly to the caller so the UI can too.
//
// ORDERING IS DELIBERATE: the tombstone is written FIRST. Every later step is
// idempotent, so a crash mid-way leaves an account that can no longer
// authenticate and a deletion that can be retried to completion — never a
// half-deleted account that still logs in.
// ---------------------------------------------------------------------------

const tombstoneKey = (userId: string) => `account:deleted:${userId}`;

interface Tombstone {
  at: string; // ISO8601
}

/**
 * Has this account been deleted? Checked by requireUser() on every request, so
 * a session minted before deletion — or held by another serverless instance
 * whose in-memory copy is still warm — stops authenticating immediately.
 *
 * Fails OPEN on a kv outage: the durable store is still the source of truth
 * (the users row is gone, so getAccountDurable misses and requireUser 401s
 * anyway). Failing closed here would lock every user out of the product
 * whenever Redis blinks.
 */
export async function isAccountDeleted(userId: string): Promise<boolean> {
  try {
    return (await kvGet<Tombstone>(tombstoneKey(userId))) !== null;
  } catch (e) {
    log.error("deletion tombstone check failed", { userId, error: (e as Error).message });
    return false;
  }
}

export interface DeletionOutcome {
  /** false when the account was already deleted — the call is idempotent. */
  deleted: boolean;
  /** Data classes erased outright. */
  erased: string[];
  /** Data classes kept, and why. Surfaced to the user; never claim total erasure. */
  retained: { record: string; reason: string }[];
}

/** Data the user must be told survives deletion. Drives the API response, the
 *  web + native confirmation copy, and the public deletion page — one source of
 *  truth, so those four surfaces cannot drift apart. */
export const RETENTION_NOTICE: DeletionOutcome["retained"] = [
  {
    record: "On-chain deposit records",
    reason:
      "Retained as the permanent record of funds that actually moved on-chain, with your account detached from them.",
  },
  {
    record: "Security and compliance audit trail",
    reason:
      "Retained for fraud prevention, dispute resolution and security auditing. It records that actions happened, not who you are.",
  },
];

/**
 * Erase an account. Idempotent: safe to call again after a partial failure, and
 * a second call on an already-deleted account reports deleted:false rather than
 * erroring.
 *
 * The caller is responsible for authenticating the user and for step-up
 * re-auth; this function trusts `userId` and never reads a client-supplied id.
 */
export async function deleteUserAccount(userId: string): Promise<DeletionOutcome> {
  if (userId === DEMO_USER_ID) {
    // Guest sessions all resolve to the seeded demo account. Deleting it would
    // wipe the shared demo surface for everyone. The route blocks guests before
    // reaching here; this is the backstop.
    throw new Error("The demo account cannot be deleted.");
  }

  const already = await isAccountDeleted(userId);
  const account = getAccount(userId);

  // 1. Tombstone first — access revocation must not be the step that fails.
  await kvSet(tombstoneKey(userId), { at: new Date().toISOString() } satisfies Tombstone);

  // 2. Revoke credentials and active access. Each is idempotent.
  await revokeCredentials(userId, account);

  // 3. Erase durable data. Postgres applies the cascade/set-null/retain split
  //    documented above in a single statement.
  if (supabaseBackend === "supabase") {
    await dbDeleteAccount(userId);
  }

  // 4. Drop the in-memory copy + identity indexes, so this instance stops
  //    resolving the account and a re-signup with the same email starts clean.
  evictAccount(userId);

  audit("account.deleted", userId, {
    backend: supabaseBackend,
    // No PII: not the email, phone, or any identifier beyond the id already
    // present as the audit actor.
    retained: RETENTION_NOTICE.map((r) => r.record),
  });

  return {
    deleted: !already,
    erased: [
      "Profile and contact details",
      "Passkeys and linked sign-in identities",
      "Balances, holdings, cards and bills",
      "Transaction history",
      "Trips and bookings",
      "Linked wallet address",
      "Push notification registrations",
      "Support conversations",
      "Agent / API keys",
    ],
    retained: RETENTION_NOTICE,
  };
}

/**
 * Revoke everything that could still authenticate or act as this user. Keys are
 * the ones the code actually writes — see webauthn.ts, fcm.ts, push.ts,
 * agentPolicy.ts, support.ts, walletLink.ts, cardAuthChallenges.ts, velocity.ts.
 *
 * Best-effort per key: one dead kv key must not abort the deletion and strand
 * the account half-erased. Failures are logged (without values) and the
 * tombstone already blocks access regardless.
 */
async function revokeCredentials(userId: string, account: UserAccount | undefined): Promise<void> {
  // Agent/API keys: revoke each record (authorization reads the durable record,
  // so this is immediate on every instance), then drop the owner index.
  try {
    for (const key of await listAgentKeys(userId)) {
      await revokeAgentKey(userId, key.keyId);
    }
  } catch (e) {
    log.error("agent key revocation failed during deletion", { userId, error: (e as Error).message });
  }

  const keys = [
    `webauthn:creds:${userId}`, // passkey credentials — MUST go, they are login
    `webauthn:chal:${userId}`,
    `push:fcm:${userId}`, // native FCM device tokens
    `push:subs:${userId}`, // web-push subscriptions
    `agent:index:${userId}`,
    `cardauth:pending:${userId}`, // pending 3DS2 challenges
    `wallet:link:challenge:${userId}`,
    `support:tickets:${userId}`,
    `vel:geo:${userId}`,
  ];

  for (const key of keys) {
    try {
      await kvDel(key);
    } catch (e) {
      // Log the KEY, never the value — these hold credentials and tokens.
      log.error("kv purge failed during deletion", { userId, key, error: (e as Error).message });
    }
  }

  // Cards issued to this user are erased by the cascade, but a card-auth
  // webhook could still arrive for one. It resolves the owner via
  // findAccountByCard → getAccountDurable, which now misses. Nothing to purge.
  void account;
}
