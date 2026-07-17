import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// The local SQLite cache (furlpay.db) is deliberately NOT encrypted at rest —
// expo-sqlite exposes no SQLCipher key, and encrypting it would mean swapping
// the native driver. That decision is ONLY defensible while the invariant below
// holds:
//
//     NO authentication credential, mnemonic, private key, session token or
//     passkey secret is ever written to SQLite. Secrets live in SecureStore,
//     backed by the Android Keystore.
//
// If someone later caches a signed authorization, an API key, or the session
// JWT in a table "just for offline", the risk calculus inverts silently and a
// rooted device becomes an account-takeover, not a history leak. So the
// invariant is a test, not a comment.
//
// See docs/ANDROID-RELEASE.md — "Local cache encryption decision".
// ---------------------------------------------------------------------------

const LIB = path.join(__dirname, "..");
const db = fs.readFileSync(path.join(LIB, "db.ts"), "utf8");

/** Identifiers that would mean a secret is being persisted. */
const SECRET_SHAPED = [
  "mnemonic",
  "privatekey",
  "private_key",
  "seedphrase",
  "seed_phrase",
  "totpsecret",
  "totp_secret",
  "sessiontoken",
  "session_token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "passkey_secret",
  "credential_private",
];

describe("SQLite cache — no-secrets invariant", () => {
  it("db.ts never imports SecureStore (the two stores must not blur)", () => {
    expect(db).not.toMatch(/expo-secure-store/);
  });

  it("no table column is secret-shaped", () => {
    const lower = db.toLowerCase();
    const found = SECRET_SHAPED.filter((s) => lower.includes(s));
    if (found.length) {
      throw new Error(
        `db.ts mentions ${found.join(", ")}. If a secret is now persisted in SQLite, the ` +
          `"unencrypted cache is acceptable" decision is VOID — encrypt the DB ` +
          `(@op-engineering/op-sqlite) or move the value to SecureStore.`
      );
    }
    expect(found).toEqual([]);
  });

  it("the schema is exactly the four cache tables we classified", () => {
    const tables = [...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
    // kv_cache      -> JSON snapshots of GET responses (balances, cards, portfolio)
    // transactions  -> financial transaction METADATA (amounts, titles, status)
    // pending_actions -> offline outbox; replay still requires the session JWT
    // notifications -> cosmetic inbox (title/body/url)
    expect(tables).toEqual(["kv_cache", "notifications", "pending_actions", "transactions"]);
  });

  it("clearAllCaches wipes every one of them (cross-account leakage guard)", () => {
    const wipe = db.match(/export function clearAllCaches[\s\S]*?\n}/)?.[0] ?? "";
    expect(wipe).not.toBe("");
    // Every table classified above must be dropped on sign-out, or the next
    // account on this device inherits the previous one's cached data.
    for (const t of ["kv_cache", "transactions", "pending_actions", "notifications"]) {
      expect(wipe).toContain(t);
    }
  });
});
