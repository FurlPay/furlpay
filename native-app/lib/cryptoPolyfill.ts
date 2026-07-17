import { getRandomValues, randomUUID } from "expo-crypto";

// ---------------------------------------------------------------------------
// Hermes (React Native's engine) ships NO global `crypto`. Code across the app
// calls crypto.randomUUID() (per-request correlation ids in lib/api.ts, offline
// idempotency keys in lib/db.ts, chat/support message ids) and
// crypto.getRandomValues(). Without this shim every one of those throws
//   "Property 'crypto' doesn't exist"
// at runtime — and because lib/api.ts mints a correlation id at the top of
// EVERY request, that breaks all networking: OTP, Google sign-in, guest, sync.
//
// Unit tests never caught it: Node (web vitest) and jest-expo both provide a
// global `crypto`. Only a real on-device run surfaces the gap. Found on a
// Redmi Note 10 Pro / Android 16, 2026-07-14.
//
// Backed by expo-crypto (already a dependency), whose getRandomValues/randomUUID
// are WebCrypto-compatible. Imported FIRST from index.js, before any app module
// loads, so even a module-load-time crypto call is covered.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { crypto?: Record<string, unknown> };

if (!g.crypto) {
  g.crypto = {};
}
const c = g.crypto as Record<string, unknown>;

if (typeof c.getRandomValues !== "function") {
  // expo-crypto's getRandomValues fills and returns the typed array (WebCrypto).
  c.getRandomValues = getRandomValues;
}
if (typeof c.randomUUID !== "function") {
  c.randomUUID = randomUUID;
}
