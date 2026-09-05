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

  it("the schema is exactly the seven tables we classified", () => {
    const tables = [...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
    // kv_cache      -> JSON snapshots of GET responses (balances, cards, portfolio)
    // transactions  -> financial transaction METADATA (amounts, titles, status)
    // pending_actions -> offline outbox; replay still requires the session JWT
    // notifications -> cosmetic inbox (title/body/url)
    // swaps         -> swap journal: route ids, public tx hashes, amounts and
    //                  status. Public-ledger metadata — every hash in it is
    //                  already visible to anyone with a block explorer, and it
    //                  holds no key, signature or authorization. Persisting it
    //                  is what lets a bridge survive the app being killed.
    // device_prefs  -> DEVICE preferences only (theme, locale). The ONE table
    //                  sign-out does not wipe, which is exactly why it must
    //                  never hold anything account-scoped. Guarded below.
    // money_transactions -> durable state of money movements the app attempted:
    //                  amount, destination, state, idempotency key. Holds NO
    //                  secret material (guarded below). Account-scoped, so it
    //                  IS wiped on sign-out; its durability requirement is
    //                  surviving process death, not sign-out.
    expect(tables).toEqual([
      "device_prefs",
      "kv_cache",
      "money_transactions",
      "notifications",
      "pending_actions",
      "swaps",
      "transactions",
    ]);
  });

  describe("device_prefs — the deliberate exception to the sign-out wipe", () => {
    const schema = db.match(/CREATE TABLE IF NOT EXISTS device_prefs[\s\S]*?\);/)?.[0] ?? "";

    it("exists", () => {
      expect(schema).not.toBe("");
    });

    it("is a bare key/value store with no account scoping", () => {
      // An account column would be the first step toward this table holding
      // per-user state — which, since it survives sign-out, would leak the
      // previous user's settings to the next one.
      const cols = schema.toLowerCase();
      expect(cols).toContain("key text primary key");
      expect(cols).toContain("value text not null");
      for (const forbidden of ["user", "account", "session", "token", "email", "wallet"]) {
        expect(cols).not.toContain(forbidden);
      }
    });

    it("is deliberately NOT wiped by clearAllCaches", () => {
      // This is an assertion about intent, not an oversight. A user who chose
      // Hindi and light mode should not be reset to English dark because they
      // signed out. The safety of that choice rests entirely on the previous
      // test: nothing account-scoped may live here.
      const wipe = db.match(/export function clearAllCaches[\s\S]*?\n}/)?.[0] ?? "";
      expect(wipe).not.toBe("");
      expect(wipe).not.toContain("device_prefs");
    });

    it("is only ever written with ui.* keys", () => {
      // The table's safety depends on WHAT goes in it, so the call sites are
      // checked too, not just the schema.
      const fs2 = require("fs") as typeof import("fs");
      const pathMod = require("path") as typeof import("path");
      const roots = ["design/theme.tsx", "i18n/core.ts"];
      const keys: string[] = [];
      for (const rel of roots) {
        const src = fs2.readFileSync(pathMod.join(LIB, rel), "utf8");
        for (const m of src.matchAll(/const PREF_KEY = "([^"]+)"/g)) keys.push(m[1]);
      }
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(k).toMatch(/^ui\./);
    });
  });

  it("the swap journal stores no signed payload", () => {
    // A journal is a record of what happened. If it ever starts holding the raw
    // signed transaction, that is a broadcastable, replayable artifact sitting
    // in an unencrypted database — and the invariant at the top of this file
    // no longer holds.
    const schema = db.match(/CREATE TABLE IF NOT EXISTS swaps[\s\S]*?\);/)?.[0] ?? "";
    expect(schema).not.toBe("");
    for (const forbidden of ["raw", "signed", "signature", "calldata", "payload"]) {
      expect(schema.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("clearAllCaches wipes every one of them (cross-account leakage guard)", () => {
    const wipe = db.match(/export function clearAllCaches[\s\S]*?\n}/)?.[0] ?? "";
    expect(wipe).not.toBe("");
    // Every table classified above must be dropped on sign-out, or the next
    // account on this device inherits the previous one's cached data.
    for (const t of ["kv_cache", "transactions", "pending_actions", "notifications", "swaps", "money_transactions"]) {
      expect(wipe).toContain(t);
    }
  });
});
