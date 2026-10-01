import { getBaseUrl } from "./api";

// ---------------------------------------------------------------------------
// Extension product analytics → POST {base}/api/analytics/events/batch.
//
// SAME CONTRACT AS EVERY CLIENT (apps/web/src/lib/analytics/contract.ts; a web
// parity test reads EXTENSION_EVENTS below and fails if it drifts).
//
// WHAT THE EXTENSION REPORTS: its own lifecycle and the decisions the user makes
// in ITS UI (install, start, connect consent, travel search, card-challenge
// decline). NEVER: visited URLs, page contents, form data, cookies, keys, seed
// phrases, recipient addresses, amounts. There is deliberately no message type
// that lets a content script or web page submit an event; only background code
// calls track().
//
// IDENTITY: the furlpay.com session cookie (credentials: "include"), exactly
// like every other API call here. The server derives the user; nothing about
// the user is sent. installationId is a random id created on first run and
// stored in extension storage: not a fingerprint, not shared with pages.
//
// FAILURE: analytics never blocks the extension. Events wait in a bounded
// queue (MAX_QUEUE, MAX_AGE); a failed flush keeps them for the next alarm,
// up to MAX_ATTEMPTS; then they are dropped. Rejected events are dropped.
// ---------------------------------------------------------------------------

export const EXTENSION_EVENTS = [
  "extension_installed",
  "extension_started",
  "extension_connected",
  "wallet_connected",
  "travel_search",
  "transaction_requested",
  "transaction_rejected",
  "error_occurred",
] as const;
export type ExtensionEvent = (typeof EXTENSION_EVENTS)[number];

const QUEUE_KEY = "fp_analytics_queue";
const INSTALL_KEY = "fp_installation_id";
const MAX_QUEUE = 100;
const MAX_AGE_MS = 3 * 86_400_000; // the server refuses events older than 7 days
const MAX_ATTEMPTS = 5;
const BATCH = 50;

interface Queued {
  event: Record<string, unknown>;
  attempts: number;
}

const META_KEYS = new Set(["source", "outcome", "reason", "errorCode", "step"]);

async function installationId(): Promise<string> {
  const got = (await browser.storage.local.get(INSTALL_KEY))[INSTALL_KEY];
  if (typeof got === "string") return got;
  const id = crypto.randomUUID();
  await browser.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

export async function track(eventName: ExtensionEvent, metadata: Record<string, string | number | boolean> = {}): Promise<void> {
  try {
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(metadata)) if (META_KEYS.has(k)) clean[k] = typeof v === "string" ? v.slice(0, 64) : v;
    const event = {
      schemaVersion: 1,
      eventId: crypto.randomUUID().replace(/-/g, ""),
      eventName,
      platform: "chrome_extension",
      timestamp: new Date().toISOString(),
      appVersion: browser.runtime.getManifest().version,
      installationId: await installationId(),
      metadata: clean,
    };
    const queue = ((await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Queued[] | undefined) ?? [];
    queue.push({ event, attempts: 0 });
    await browser.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
  } catch {
    // Analytics must never break the extension.
  }
}

/** Upload queued events. Called from the background alarm; safe to call often. */
export async function flush(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ sent: number; kept: number; dropped: number }> {
  const stored = ((await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Queued[] | undefined) ?? [];
  const fresh = stored.filter((q) => now - Date.parse(String(q.event.timestamp)) < MAX_AGE_MS && q.attempts < MAX_ATTEMPTS);
  let dropped = stored.length - fresh.length;
  if (!fresh.length) {
    await browser.storage.local.set({ [QUEUE_KEY]: [] });
    return { sent: 0, kept: 0, dropped };
  }
  const batch = fresh.slice(0, BATCH);
  const rest = fresh.slice(BATCH);
  let ok = false;
  try {
    const res = await fetchImpl(`${await getBaseUrl()}/api/analytics/events/batch`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch.map((q) => q.event) }),
    });
    // 202: stored or rejected per event — either way, done with them.
    // 400 (malformed batch) is not retryable either. 401/429/5xx: retry later.
    ok = res.status === 202 || res.status === 400;
    if (res.status === 400) dropped += batch.length;
  } catch {
    ok = false;
  }
  const kept = ok ? rest : [...batch.map((q) => ({ ...q, attempts: q.attempts + 1 })), ...rest];
  await browser.storage.local.set({ [QUEUE_KEY]: kept });
  return { sent: ok ? batch.length : 0, kept: kept.length, dropped };
}
