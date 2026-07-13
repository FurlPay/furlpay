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

/** Wipe everything user-scoped (called on sign-out). */
export function clearAllCaches(): void {
  const d = getDb();
  d.execSync("DELETE FROM kv_cache; DELETE FROM transactions; DELETE FROM pending_actions;");
}
