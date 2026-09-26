import * as SQLite from "expo-sqlite";

function getDb(): SQLite.SQLiteDatabase {
  return SQLite.openDatabaseSync("furlpay.db");
}

export async function incrementAndGet(keyId: string): Promise<number> {
  const db = getDb();
  
  // Create row if not exists with 0
  db.runSync(
    "INSERT OR IGNORE INTO signing_counters (key_id, counter) VALUES (?, 0)",
    [keyId]
  );
  
  // Increment atomically
  db.runSync(
    "UPDATE signing_counters SET counter = counter + 1 WHERE key_id = ?",
    [keyId]
  );
  
  // Get value
  const result = db.getFirstSync<{ counter: number }>(
    "SELECT counter FROM signing_counters WHERE key_id = ?",
    [keyId]
  );
  
  return result?.counter || 1;
}

export async function getCounter(keyId: string): Promise<number> {
  const db = getDb();
  
  const result = db.getFirstSync<{ counter: number }>(
    "SELECT counter FROM signing_counters WHERE key_id = ?",
    [keyId]
  );
  
  return result?.counter || 0;
}

export async function verifyMonotonic(keyId: string, expectedMin: number): Promise<boolean> {
  const current = await getCounter(keyId);
  return current >= expectedMin;
}
