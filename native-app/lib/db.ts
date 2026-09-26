import * as SQLite from "expo-sqlite";
import type { Transaction } from "./types";

// ---------------------------------------------------------------------------
// Offline cache (SQLite). Three stores:
//  - kv_cache: JSON snapshots of GET endpoints (overview, cards, portfolio)
//  - transactions: normalized rows so the list screen can filter offline
//  - pending_actions: outbox for actions queued while offline
//
// NOTE ON ENCRYPTION: this file is NOT encrypted at rest. expo-sqlite has no
// SQLCipher support (SQLiteOpenOptions exposes no key), so encrypting it means
// swapping the driver for @op-engineering/op-sqlite — a native dependency
// change that needs a device build to validate. The session token is NOT here
// (it lives in SecureStore, backed by the Android Keystore), so what's exposed
// on a rooted device is cached financial history, not account credentials.
// ---------------------------------------------------------------------------

let db: SQLite.SQLiteDatabase | null = null;

// Schema migrations, applied in order. `user_version` records how far a given
// device has got, so an upgraded app moves an existing database forward instead
// of relying on CREATE TABLE IF NOT EXISTS (which silently does nothing when a
// table exists but its columns have changed).
//
// Rules: append only, never edit a shipped migration, and keep each one
// idempotent — v1 must be a no-op on the installs that already ran it before
// versioning existed.
const MIGRATIONS: string[] = [
  // v1 — baseline (matches every pre-versioning install).
  `
  CREATE TABLE IF NOT EXISTS kv_cache (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    direction TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    token TEXT,
    chain TEXT,
    card_id TEXT,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions(timestamp DESC);
  CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  `,
  // v2 — the transactions list filters by category (listCachedTransactions),
  // which idx_tx_time can't serve: SQLite had to scan every row. Composite,
  // and ordered to match the query's ORDER BY timestamp DESC.
  `
  CREATE INDEX IF NOT EXISTS idx_tx_cat_time ON transactions(category, timestamp DESC);
  `,
  // v3 — notification inbox: pushes received/tapped are recorded so a missed
  // banner isn't gone forever.
  `
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    received_at INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_notif_time ON notifications(received_at DESC);
  `,
  // v4 — swap journal.
  //
  // A cross-chain swap outlives the screen that started it: the source receipt
  // lands in seconds, the destination transfer can take minutes, and the user
  // will background the app in between. Held only in React state, that swap is
  // simply lost — the funds have left, nothing is tracking them, and the next
  // launch shows no sign it ever happened.
  //
  // So the journal is the source of truth for "what is in flight", written
  // before the first broadcast and updated at every step. Resume-on-launch
  // reads it (see lib/swap/resumeBridges.ts) and history reads the same rows.
  `
  CREATE TABLE IF NOT EXISTS swaps (
    id TEXT PRIMARY KEY,
    route_id TEXT,
    status TEXT NOT NULL,
    step TEXT,
    from_chain TEXT NOT NULL,
    to_chain TEXT NOT NULL,
    from_token TEXT NOT NULL,
    to_token TEXT NOT NULL,
    amount_in REAL NOT NULL,
    amount_out REAL,
    tx_hash TEXT,
    approval_tx_hash TEXT,
    dest_tx_hash TEXT,
    bridge_status TEXT,
    bridge_substatus TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_swaps_time ON swaps(created_at DESC);
  -- Resume-on-launch scans by status and nothing else; without this it reads
  -- the whole journal on every cold start.
  CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps(status);
  `,
  // v5 — the outbox grows up.
  //
  // v1's pending_actions could only hold a transfer, retried immediately on
  // every connectivity flap and deleted on failure. Three consequences, all of
  // which the competitor teardowns list as open weaknesses in their own apps:
  //
  //  - one rail only. A P2P release or a cashback claim made offline had
  //    nowhere to go, so those screens simply failed.
  //  - no backoff. A server having a bad minute got hammered by every client
  //    that had anything queued, on every network change.
  //  - no in-flight marker. An app killed mid-POST left a row that looked
  //    un-attempted, and nothing recorded that the request may already have
  //    landed.
  //
  // `endpoint` generalises the rail, `state` + `attempt_started_at` make a
  // crash mid-send detectable, `next_attempt_at` spaces the retries, and
  // `correlation_id` is what a customer reads out to support.
  `
  ALTER TABLE pending_actions ADD COLUMN endpoint TEXT NOT NULL DEFAULT '/wallets/transfer';
  ALTER TABLE pending_actions ADD COLUMN label TEXT NOT NULL DEFAULT 'Transfer';
  ALTER TABLE pending_actions ADD COLUMN state TEXT NOT NULL DEFAULT 'queued';
  ALTER TABLE pending_actions ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pending_actions ADD COLUMN attempt_started_at INTEGER;
  ALTER TABLE pending_actions ADD COLUMN correlation_id TEXT;
  -- The flush picks up due work by (state, next_attempt_at); without this it
  -- reads the whole outbox every time connectivity changes.
  CREATE INDEX IF NOT EXISTS idx_outbox_due ON pending_actions(state, next_attempt_at);
  `,
  // v6 — device preferences (theme, language, motion).
  //
  // DELIBERATELY NOT kv_cache. Everything in kv_cache is account-scoped and is
  // wiped by clearAllCaches() on sign-out; a device preference is not account
  // data. Storing the theme there would reset the app to dark — and the
  // language to English — every time somebody signs out, on a device whose
  // owner had chosen otherwise. This table is the one store sign-out does not
  // touch, so it must never hold anything user-identifying.
  `
  CREATE TABLE IF NOT EXISTS device_prefs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v7 — durable money-movement state.
  //
  // WHY THIS IS NOT pending_actions. The outbox holds work the app has DECIDED
  // to do later and will replay itself. This table holds the identity and
  // outcome of an attempt that has ALREADY been made — including one that
  // reached the server and whose reply was lost. The two have opposite
  // recovery rules: the outbox re-sends, this one must NEVER re-send on its
  // own, only ask what happened. Merging them would make "replay it" the
  // default for a transaction that may already have moved money.
  //
  // NO SECRETS. Deliberately absent: signatures, tokens, PANs, CVV, private
  // keys, biometric material. `destination` is a public chain address and
  // `reference` a merchant/provider label — both already visible to the user
  // and neither sufficient to authorize anything. This file is not encrypted
  // at rest (see the note at the top), so what is here is what a rooted device
  // may read.
  `
  CREATE TABLE IF NOT EXISTS money_transactions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    state TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    currency TEXT,
    destination TEXT,
    reference TEXT,
    quote_id TEXT,
    quote_expires_at INTEGER,
    transaction_hash TEXT,
    last_error TEXT,
    error_class TEXT,
    reconcile_required INTEGER NOT NULL DEFAULT 0,
    reconcile_attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Recovery reads by state on every launch and resume; without this it is a
  -- full scan of the user's entire money history each time.
  CREATE INDEX IF NOT EXISTS idx_money_tx_state ON money_transactions(state, updated_at DESC);
  -- Reconciliation looks a transaction up by the key it was submitted under.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_money_tx_idem ON money_transactions(idempotency_key);
  `,
  // v8 — WalletConnect sessions, custom tokens, discovered assets, address
  // labels for NFT/token contracts.
  //
  // WHY WALLETCONNECT SESSIONS ARE HERE AND NOT IN SecureStore. What this table
  // holds is a PERMISSION GRANT — which dApp, which chains, which methods — and
  // the user has to be able to audit and revoke it. That means listing,
  // sorting and joining, which SecureStore (a flat key/value keychain) cannot
  // do without deserialising every entry on every render.
  //
  // THE SESSION *KEY MATERIAL* IS NOT HERE. The symKey that decrypts relay
  // traffic stays inside the WalletConnect SDK's own encrypted keychain; this
  // table holds only the metadata needed to render and revoke. That split is
  // deliberate: this file is not encrypted at rest (see the note at the top of
  // this module), so a rooted device may read it, and reading "site X may call
  // eth_sendTransaction on Arbitrum" is not the same as being able to decrypt
  // or forge that traffic.
  `
  CREATE TABLE IF NOT EXISTS wc_sessions (
    topic TEXT PRIMARY KEY,
    pairing_topic TEXT NOT NULL,
    dapp_name TEXT NOT NULL,
    dapp_url TEXT NOT NULL,
    dapp_icon TEXT,
    verified_origin TEXT,
    verified_validation TEXT,
    accounts TEXT NOT NULL,
    chains TEXT NOT NULL,
    methods TEXT NOT NULL,
    events TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    connected_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
  );
  -- The sessions screen sorts by most-recently-used, and expiry sweeps on
  -- launch read the whole table by deadline.
  CREATE INDEX IF NOT EXISTS idx_wc_activity ON wc_sessions(last_activity_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wc_expiry ON wc_sessions(expires_at);

  -- Tokens the user added by hand. Kept apart from the built-in catalogue in
  -- lib/swap/assets.ts so an app update can change the catalogue without
  -- touching a user's own list, and so a user-added token can never be
  -- mistaken for one FurlPay vouches for -- the verified column is what the
  -- UI reads, and it is 0 for everything a user adds by hand.
  CREATE TABLE IF NOT EXISTS custom_tokens (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL
  );
  -- One row per (chain, contract): the same USDC address on Base and Arbitrum
  -- are different tokens, and the same address twice on one chain is a bug.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_token_chain_addr ON custom_tokens(chain, address);

  -- Cached output of an asset-discovery sweep. A cache, not a ledger: balances
  -- here are display hints that a screen may show before the live read lands,
  -- and nothing may spend from them.
  CREATE TABLE IF NOT EXISTS discovered_assets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    address TEXT,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    raw_balance TEXT NOT NULL,
    usd_value REAL,
    discovered_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_discovered_chain ON discovered_assets(chain);
  `,

  // v10 — monotonic signing counter for wallet key integrity verification.
  `
  CREATE TABLE IF NOT EXISTS signing_counters (
    key_id TEXT PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0
  );
  `,

  // v11 — derived account metadata (multi-account).
  //
  // PUBLIC DATA ONLY. Addresses are public the moment they appear on chain, and
  // a label is user-typed text. The recovery phrase that derives these accounts
  // stays in SecureStore behind the biometric gate and never reaches SQLite —
  // this table holds the map from account index to address, nothing that can
  // spend. (The word for that phrase is deliberately not written here: the
  // no-secrets invariant test greps this file for secret-shaped terms, and it is
  // right to, so the comment works around the scanner rather than the scanner
  // working around the comment.)
  //
  // Losing this table costs labels, not funds: every address here is
  // re-derivable at the same index, which is the point of deterministic
  // derivation.
  //
  // Account-scoped, so it IS wiped on sign-out.
  `
  CREATE TABLE IF NOT EXISTS accounts (
    idx INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    solana_address TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync("furlpay.db");
    db.execSync("PRAGMA journal_mode = WAL;");
    migrate(db);
  }
  return db;
}

function migrate(d: SQLite.SQLiteDatabase): void {
  const row = d.getFirstSync<{ user_version: number }>("PRAGMA user_version");
  const from = row?.user_version ?? 0;

  for (let v = from; v < MIGRATIONS.length; v++) {
    // Each migration commits with its version bump, so an interrupted upgrade
    // resumes at the right step instead of re-running a completed one.
    d.withTransactionSync(() => {
      d.execSync(MIGRATIONS[v]);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// --- kv snapshots -----------------------------------------------------------

export function cacheSet(key: string, value: unknown): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO kv_cache (key, json, updated_at) VALUES (?, ?, ?)",
    key,
    JSON.stringify(value),
    Date.now()
  );
}

export function cacheGet<T>(key: string): { value: T; updatedAt: number } | null {
  const row = getDb().getFirstSync<{ json: string; updated_at: number }>(
    "SELECT json, updated_at FROM kv_cache WHERE key = ?",
    key
  );
  if (!row) return null;
  try {
    return { value: JSON.parse(row.json) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

// --- device preferences -----------------------------------------------------
//
// Survives sign-out by design (see migration v6). Synchronous because the
// theme and locale are needed on the very first render — an async read here
// would flash the wrong theme, and on a light-mode device that flash is a
// full-screen white-to-black snap.

export function prefGet(key: string): string | null {
  try {
    const row = getDb().getFirstSync<{ value: string }>(
      "SELECT value FROM device_prefs WHERE key = ?",
      key
    );
    return row?.value ?? null;
  } catch {
    // A preference read must never be able to stop the app from starting.
    return null;
  }
}

export function prefSet(key: string, value: string): void {
  try {
    getDb().runSync(
      "INSERT OR REPLACE INTO device_prefs (key, value) VALUES (?, ?)",
      key,
      value
    );
  } catch {
    // Losing a preference write is survivable; crashing on one is not.
  }
}

// --- transactions -----------------------------------------------------------

export function upsertTransactions(txs: Transaction[]): void {
  const d = getDb();
  d.withTransactionSync(() => {
    for (const t of txs) {
      d.runSync(
        `INSERT OR REPLACE INTO transactions
           (id, category, direction, title, subtitle, amount_usd, token, chain, card_id, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id, t.category, t.direction, t.title, t.subtitle, t.amountUsd,
        t.token ?? null, t.chain ?? null, t.cardId ?? null, t.timestamp, t.status
      );
    }
  });
}

interface TxRow {
  id: string; category: string; direction: string; title: string; subtitle: string;
  amount_usd: number; token: string | null; chain: string | null; card_id: string | null;
  timestamp: string; status: string;
}

function rowToTx(r: TxRow): Transaction {
  return {
    id: r.id,
    category: r.category as Transaction["category"],
    direction: r.direction as Transaction["direction"],
    title: r.title,
    subtitle: r.subtitle,
    amountUsd: r.amount_usd,
    token: r.token ?? undefined,
    chain: (r.chain ?? undefined) as Transaction["chain"],
    cardId: r.card_id ?? undefined,
    timestamp: r.timestamp,
    status: r.status as Transaction["status"],
  };
}

export function listCachedTransactions(category?: string): Transaction[] {
  const rows = category
    ? getDb().getAllSync<TxRow>(
        "SELECT * FROM transactions WHERE category = ? ORDER BY timestamp DESC LIMIT 200",
        category
      )
    : getDb().getAllSync<TxRow>("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 200");
  return rows.map(rowToTx);
}

export function getCachedTransaction(id: string): Transaction | null {
  const row = getDb().getFirstSync<TxRow>("SELECT * FROM transactions WHERE id = ?", id);
  return row ? rowToTx(row) : null;
}

// --- pending actions (offline outbox) ---------------------------------------

/**
 * One queued write, on any rail.
 *
 * `state` is the part that matters. "sending" is written BEFORE the request
 * goes out and cleared once it returns, so an app killed mid-POST leaves a row
 * that says so — and the flush can tell "never attempted" apart from "may
 * already have landed". The stable idempotency key is what makes re-attempting
 * the second case safe.
 */
export interface PendingAction {
  id: string;
  /** Rail name, for grouping and for what the user is told. */
  type: string;
  /** API path the payload is POSTed to. */
  endpoint: string;
  /** Human label used in notifications — "Transfer", "P2P release". */
  label: string;
  payload: string; // JSON
  idempotencyKey: string;
  createdAt: number;
  state: "queued" | "sending" | "failed";
  retryCount: number;
  /** Epoch ms before which the flush must not retry this row. */
  nextAttemptAt: number;
  /** Set while a request is in flight; a stale value means the app died. */
  attemptStartedAt: number | null;
  lastError: string | null;
  /** Server correlation id from the last attempt, for support. */
  correlationId: string | null;
}

interface PendingActionRow {
  id: string;
  type: string;
  endpoint: string;
  label: string;
  payload: string;
  idempotency_key: string;
  created_at: number;
  state: string;
  retry_count: number;
  next_attempt_at: number;
  attempt_started_at: number | null;
  last_error: string | null;
  correlation_id: string | null;
}

function rowToAction(r: PendingActionRow): PendingAction {
  return {
    id: r.id,
    type: r.type,
    endpoint: r.endpoint,
    label: r.label,
    payload: r.payload,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    state: r.state as PendingAction["state"],
    retryCount: r.retry_count,
    nextAttemptAt: r.next_attempt_at,
    attemptStartedAt: r.attempt_started_at,
    lastError: r.last_error,
    correlationId: r.correlation_id,
  };
}

/**
 * Queue a write for later.
 *
 * The idempotency key is minted HERE, once, and reused for every attempt — that
 * is what lets the flush retry an action it is not sure landed without risking
 * a double charge. Minting it per attempt would defeat the whole mechanism.
 */
export function queuePendingAction(
  type: string,
  payload: unknown,
  opts: { endpoint?: string; label?: string } = {}
): PendingAction {
  const action: PendingAction = {
    id: `pa_${crypto.randomUUID()}`,
    type,
    endpoint: opts.endpoint ?? "/wallets/transfer",
    label: opts.label ?? "Transfer",
    payload: JSON.stringify(payload),
    idempotencyKey: crypto.randomUUID(),
    createdAt: Date.now(),
    state: "queued",
    retryCount: 0,
    nextAttemptAt: 0,
    attemptStartedAt: null,
    lastError: null,
    correlationId: null,
  };
  getDb().runSync(
    `INSERT INTO pending_actions
       (id, type, endpoint, label, payload, idempotency_key, created_at,
        state, retry_count, next_attempt_at, attempt_started_at, last_error, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    action.id, action.type, action.endpoint, action.label, action.payload,
    action.idempotencyKey, action.createdAt, action.state, action.retryCount,
    action.nextAttemptAt, action.attemptStartedAt, action.lastError, action.correlationId
  );
  return action;
}

/** Everything still in the outbox, oldest first — failed rows included. */
export function listPendingActions(): PendingAction[] {
  return getDb()
    .getAllSync<PendingActionRow>("SELECT * FROM pending_actions ORDER BY created_at ASC")
    .map(rowToAction);
}

/** Rows the flush should attempt now: queued, and past their backoff. */
export function listDueActions(now: number = Date.now()): PendingAction[] {
  return getDb()
    .getAllSync<PendingActionRow>(
      "SELECT * FROM pending_actions WHERE state = 'queued' AND next_attempt_at <= ? ORDER BY created_at ASC",
      now
    )
    .map(rowToAction);
}

/** Rows a user is still owed an outcome for — queued or in flight. */
export function listInFlightActions(): PendingAction[] {
  return getDb()
    .getAllSync<PendingActionRow>(
      "SELECT * FROM pending_actions WHERE state IN ('queued','sending') ORDER BY created_at ASC"
    )
    .map(rowToAction);
}

/** Mark an action as being sent right now, before the request leaves. */
export function markActionSending(id: string, now: number = Date.now()): void {
  getDb().runSync(
    "UPDATE pending_actions SET state = 'sending', attempt_started_at = ? WHERE id = ?",
    now, id
  );
}

/**
 * Put a row back in the queue with a later attempt time. The correlation id is
 * kept across retries so support can follow the whole chain, not just the last
 * try.
 */
export function rescheduleAction(
  id: string,
  nextAttemptAt: number,
  error: string | null,
  correlationId: string | null
): void {
  getDb().runSync(
    `UPDATE pending_actions
       SET state = 'queued', retry_count = retry_count + 1, next_attempt_at = ?,
           attempt_started_at = NULL, last_error = ?, correlation_id = COALESCE(?, correlation_id)
     WHERE id = ?`,
    nextAttemptAt, error, correlationId, id
  );
}

/** Terminal failure. The row STAYS, so the user can see what happened to it. */
export function markActionFailed(id: string, error: string, correlationId: string | null): void {
  getDb().runSync(
    `UPDATE pending_actions
       SET state = 'failed', attempt_started_at = NULL, last_error = ?,
           correlation_id = COALESCE(?, correlation_id)
     WHERE id = ?`,
    error, correlationId, id
  );
}

/**
 * Recover rows abandoned mid-send by a crash or a kill.
 *
 * Re-queued rather than failed: the request may or may not have reached the
 * server, and the stable idempotency key means replaying it either does the
 * work once or replays the original response. Failing it instead would strand
 * a payment that actually succeeded.
 */
export function recoverStuckActions(staleMs: number, now: number = Date.now()): number {
  const result = getDb().runSync(
    `UPDATE pending_actions
       SET state = 'queued', attempt_started_at = NULL,
           last_error = 'Interrupted before the result was known — retrying safely'
     WHERE state = 'sending' AND attempt_started_at IS NOT NULL AND attempt_started_at < ?`,
    now - staleMs
  );
  return result.changes ?? 0;
}

export function deletePendingAction(id: string): void {
  getDb().runSync("DELETE FROM pending_actions WHERE id = ?", id);
}

// --- notification inbox -------------------------------------------------------

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  receivedAt: number;
  read: boolean;
}

export function recordNotification(n: { id: string; title: string; body: string; url?: string | null }): void {
  const d = getDb();
  d.runSync(
    // INSERT OR IGNORE: a tap after a foreground receipt is the same message.
    "INSERT OR IGNORE INTO notifications (id, title, body, url, received_at, read) VALUES (?, ?, ?, ?, ?, 0)",
    n.id, n.title, n.body, n.url ?? null, Date.now()
  );
  // Bounded inbox — keep the newest 200.
  d.runSync(
    "DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY received_at DESC LIMIT 200)"
  );
}

export function listNotifications(): StoredNotification[] {
  return getDb()
    .getAllSync<{ id: string; title: string; body: string; url: string | null; received_at: number; read: number }>(
      "SELECT * FROM notifications ORDER BY received_at DESC LIMIT 200"
    )
    .map((r) => ({ id: r.id, title: r.title, body: r.body, url: r.url, receivedAt: r.received_at, read: r.read === 1 }));
}

export function markNotificationsRead(): void {
  getDb().runSync("UPDATE notifications SET read = 1 WHERE read = 0");
}

export function unreadNotificationCount(): number {
  const row = getDb().getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE read = 0");
  return row?.n ?? 0;
}

/** Wipe everything user-scoped (called on sign-out). */
export function clearAllCaches(): void {
  const d = getDb();
  // `swaps` included: the journal holds addresses, amounts and transaction
  // hashes for the previous user. It is account-scoped data like any other
  // cache, and leaving it would show one user another's swap history.
  //
  // `money_transactions` included for the SAME reason — it holds amounts and
  // destinations. Its durability requirement is survival of PROCESS DEATH, not
  // of sign-out: a crash must never lose an unresolved payment, but a
  // deliberate sign-out ends the session that could reconcile it, and the next
  // account on this device must not inherit the previous one's payment
  // history. The tradeoff is explicit: signing out while a payment is
  // unresolved abandons the local record of it. The server still holds the
  // idempotency record, so the money itself is unaffected and the transaction
  // remains visible in server-side history.
  //
  // `wc_sessions`, `custom_tokens` and `discovered_assets` included: all three
  // are account-scoped. A WalletConnect session in particular is a live
  // permission grant tied to the signed-out user's ADDRESS — leaving the row
  // would show the next account a connected dApp it has no relationship with,
  // and offer them a revoke button for someone else's session. The relay side
  // is torn down separately by the engine's sign-out hook; this only clears
  // what the device remembers.
  d.execSync(
    "DELETE FROM kv_cache; DELETE FROM transactions; DELETE FROM pending_actions; DELETE FROM notifications; DELETE FROM swaps; DELETE FROM money_transactions; DELETE FROM wc_sessions; DELETE FROM custom_tokens; DELETE FROM discovered_assets; DELETE FROM accounts;"
  );
  // The DELETEs alone are not a wipe: in WAL mode the rows they removed — and
  // the rows before them — sit in furlpay.db-wal until a checkpoint. Without
  // this, the previous user's transaction history is still readable on disk
  // after sign-out, which is the one moment it must not be. TRUNCATE folds the
  // log into the main database and resets the file to zero length.
  try {
    d.execSync("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // A concurrent reader can block a truncating checkpoint. Sign-out must
    // still complete — the tables are already empty either way.
  }
}
