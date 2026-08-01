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

export interface PendingAction {
  id: string;
  type: "transfer";
  payload: string; // JSON
  idempotencyKey: string;
  createdAt: number;
  retryCount: number;
  lastError: string | null;
}

export function queuePendingAction(type: PendingAction["type"], payload: unknown): PendingAction {
  const action: PendingAction = {
    id: `pa_${crypto.randomUUID()}`,
    type,
    payload: JSON.stringify(payload),
    idempotencyKey: crypto.randomUUID(),
    createdAt: Date.now(),
    retryCount: 0,
    lastError: null,
  };
  getDb().runSync(
    `INSERT INTO pending_actions (id, type, payload, idempotency_key, created_at, retry_count, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    action.id, action.type, action.payload, action.idempotencyKey,
    action.createdAt, action.retryCount, action.lastError
  );
  return action;
}

export function listPendingActions(): PendingAction[] {
  return getDb()
    .getAllSync<{
      id: string; type: string; payload: string; idempotency_key: string;
      created_at: number; retry_count: number; last_error: string | null;
    }>("SELECT * FROM pending_actions ORDER BY created_at ASC")
    .map((r) => ({
      id: r.id,
      type: r.type as PendingAction["type"],
      payload: r.payload,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      retryCount: r.retry_count,
      lastError: r.last_error,
    }));
}

export function deletePendingAction(id: string): void {
  getDb().runSync("DELETE FROM pending_actions WHERE id = ?", id);
}

export function markPendingActionError(id: string, error: string): void {
  getDb().runSync(
    "UPDATE pending_actions SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
    error, id
  );
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
  d.execSync(
    "DELETE FROM kv_cache; DELETE FROM transactions; DELETE FROM pending_actions; DELETE FROM notifications; DELETE FROM swaps;"
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
