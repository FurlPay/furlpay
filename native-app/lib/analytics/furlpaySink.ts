import type { AnalyticsSink, EventContext } from "./index";

// ---------------------------------------------------------------------------
// The FurlPay API sink: Android and iOS product analytics →
// POST {API_BASE}/analytics/events/batch, authenticated with the same session
// token every other API call uses. One contract with web and the extension
// (apps/web/src/lib/analytics/contract.ts; a web parity test reads
// NATIVE_EVENT_MAP below).
//
// EXPLICIT MAPPING, NOT A PASS-THROUGH. The in-app catalogue (events.ts) is
// richer than the server contract. Only events with a contract meaning are
// sent; everything else stays local. In particular nothing the app sees as
// "settled" is sent: completion of money movement is a ledger fact, not a
// client report (the server refuses those names anyway).
//
// PRIVACY. No user id (the server derives it from the token), no device
// identifiers (installationId is a random id this app creates; never IMEI,
// serial, advertising id or phone number), no screen contents. Props pass a
// per-event allowlist; exact amounts never left the device (buckets only).
//
// NEVER BLOCKS THE APP. Events go to a bounded persistent queue; uploads happen
// in the background; failures keep events for later (bounded attempts and age)
// and are otherwise silent. The app works identically with analytics down.
// ---------------------------------------------------------------------------

type Mapped = { eventName: string; screen?: string; metadata: Record<string, string | number | boolean> };
type Mapper = (props: Record<string, unknown>) => Mapped | null;

const pick = (props: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string") out[k] = v.slice(0, 64);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
};
const SCREEN = /^[A-Za-z0-9_./-]{1,64}$/;

/** In-app event → contract event. The keys are the ONLY in-app events sent. */
export const NATIVE_EVENT_MAP: Record<string, Mapper> = {
  app_opened: (p) => ({ eventName: "app_opened", metadata: pick(p, ["source"]) }),
  screen_viewed: (p) => (typeof p.screen === "string" && SCREEN.test(p.screen) ? { eventName: "screen_viewed", screen: p.screen, metadata: {} } : null),
  auth_started: (p) => ({ eventName: "login_started", metadata: pick(p, ["method"]) }),
  swap_submitted: (p) => ({ eventName: "swap_started", metadata: { ...pick(p, ["provider", "bucket"]), ...(typeof p.fromChain === "string" ? { chain: p.fromChain.slice(0, 64) } : {}) } }),
  send_submitted: (p) => ({ eventName: "payment_started", metadata: pick(p, ["chain", "token", "bucket"]) }),
  onramp_session_created: (p) => ({ eventName: "deposit_started", metadata: pick(p, ["provider"]) }),
};

export const CONTRACT_EVENTS_SENT = [...new Set(Object.values(NATIVE_EVENT_MAP).map((m) => m({ screen: "Home" })?.eventName).filter(Boolean))] as string[];

export interface SinkDeps {
  storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
  fetchImpl: typeof fetch;
  getToken(): Promise<string | null>;
  apiBase: string; // e.g. https://furlpay.com/api
  platform: "android" | "ios";
  appVersion: string | null;
  buildNumber: string | null;
  osVersion: string | null;
  uuid(): string;
  now(): number;
}

const QUEUE_KEY = "fp.analytics.queue.v1";
const INSTALL_KEY = "fp.analytics.installation";
export const MAX_QUEUE = 200;
const MAX_AGE_MS = 3 * 86_400_000;
const MAX_ATTEMPTS = 5;
const BATCH = 50;

interface Queued {
  event: Record<string, unknown>;
  attempts: number;
}

export function createFurlpaySink(deps: SinkDeps): AnalyticsSink & { upload(): Promise<{ sent: number; kept: number; dropped: number }> } {
  const sessionId = deps.uuid(); // one app run; never the user id
  let installation: Promise<string> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const installationId = () =>
    (installation ??= (async () => {
      const got = await deps.storage.getItem(INSTALL_KEY).catch(() => null);
      if (got && /^[0-9a-f-]{36}$/i.test(got)) return got;
      const id = deps.uuid();
      await deps.storage.setItem(INSTALL_KEY, id).catch(() => undefined);
      return id;
    })());

  const read = async (): Promise<Queued[]> => {
    try {
      const raw = await deps.storage.getItem(QUEUE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Queued[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (q: Queued[]) => deps.storage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))).catch(() => undefined);

  const enqueue = (mapped: Mapped, ts: number) =>
    serial(async () => {
      const event = {
        schemaVersion: 1,
        eventId: deps.uuid().replace(/-/g, ""),
        eventName: mapped.eventName,
        platform: deps.platform,
        timestamp: new Date(ts).toISOString(),
        ...(deps.appVersion ? { appVersion: deps.appVersion } : {}),
        ...(deps.buildNumber ? { buildNumber: deps.buildNumber } : {}),
        ...(deps.osVersion ? { osVersion: deps.osVersion } : {}),
        sessionId,
        installationId: await installationId(),
        ...(mapped.screen ? { screen: mapped.screen } : {}),
        metadata: mapped.metadata,
      };
      const q = await read();
      q.push({ event, attempts: 0 });
      await write(q);
    });

  const upload = () =>
    serial(async () => {
      const now = deps.now();
      const stored = await read();
      const fresh = stored.filter((x) => now - Date.parse(String(x.event.timestamp)) < MAX_AGE_MS && x.attempts < MAX_ATTEMPTS);
      let dropped = stored.length - fresh.length;
      if (!fresh.length) {
        await write([]);
        return { sent: 0, kept: 0, dropped };
      }
      const batch = fresh.slice(0, BATCH);
      const rest = fresh.slice(BATCH);
      let done = false;
      try {
        const token = await deps.getToken();
        const res = await deps.fetchImpl(`${deps.apiBase}/analytics/events/batch`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-furlpay-client": `mobile-${deps.platform}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ events: batch.map((x) => x.event) }),
        });
        done = res.status === 202 || res.status === 400;
        if (res.status === 400) dropped += batch.length;
      } catch {
        done = false;
      }
      const kept = done ? rest : [...batch.map((x) => ({ ...x, attempts: x.attempts + 1 })), ...rest];
      await write(kept);
      return { sent: done ? batch.length : 0, kept: kept.length, dropped };
    });

  return {
    name: "furlpay",
    track(name: string, props: Record<string, unknown>, context: EventContext) {
      const map = NATIVE_EVENT_MAP[name];
      if (!map) return;
      const mapped = map(props);
      if (!mapped) return;
      void enqueue(mapped, context.timestamp).catch(() => undefined);
    },
    // Identity is never sent: the server reads it from the session token.
    identify() {},
    upload,
    flush: async () => {
      await upload();
    },
  };
}
