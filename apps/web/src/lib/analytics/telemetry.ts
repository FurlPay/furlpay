// ---------------------------------------------------------------------------
// Platform telemetry for the admin dashboard's System Observability and
// Geography panels. Three signals, each written where it actually happens:
//
//   API requests     middleware, every /api/* request    ops:obs:req:<UTC hour>
//   Unhandled errors instrumentation onRequestError      ops:obs:err:<UTC hour> + ops:obs:errors
//   Active countries middleware, signed-in requests      HyperLogLog per country per day
//
// What is NOT here, and is therefore shown as unavailable rather than guessed:
// response latency (middleware runs before the handler and never sees the
// response) and function invocations (a platform billing metric).
//
// Best-effort by design: telemetry never fails or slows a request. Writes are
// handed to waitUntil by the caller, and a KV error is swallowed AFTER being
// counted in-process, so a dead store is visible in the dashboard as missing
// data rather than as user-facing errors.
//
// No PII: the error list holds a route pattern, an error class name and
// Next's digest, never the message (which can carry user input). Countries
// are counted as distinct pseudonymous members of a HyperLogLog, from which no
// user id can be read back.
//
// Edge-runtime safe (middleware imports it).
// ---------------------------------------------------------------------------

import { kvIncrBy, kvListPush, kvPfAddTtl, kvZAdd } from "@/lib/kv";

const RETENTION_SECONDS = 100 * 86_400; // covers the 90-day maximum range
export const REQ_PREFIX = "ops:obs:req:";
export const ERR_PREFIX = "ops:obs:err:";
export const ERROR_LIST = "ops:obs:errors";
export const ERROR_LIST_MAX = 200;
export const geoKey = (day: string, country: string) => `ops:analytics:geo:${day}:${country}`;
export const geoCountriesKey = (day: string) => `ops:analytics:geo:countries:${day}`;
/** Every country seen, scored by LAST-SEEN time, so a range is one ZRANGEBYSCORE. */
export const geoCountriesAllKey = "ops:analytics:geo:countries";

const hourStamp = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 13);

let writeFailures = 0;
/** Telemetry writes that failed in this process (exposed for health checks). */
export const telemetryWriteFailures = () => writeFailures;

async function safely(op: Promise<unknown>): Promise<void> {
  try {
    await op;
  } catch {
    writeFailures++;
  }
}

export function recordApiRequest(now = Date.now()): Promise<void> {
  return safely(kvIncrBy(`${REQ_PREFIX}${hourStamp(now)}`, 1, RETENTION_SECONDS));
}

export interface ServerErrorEntry {
  ts: string;
  route: string; // route PATTERN (/api/payments/[id]), never the concrete URL
  routeType: string; // "route" | "render" | "action" | "middleware"
  method: string;
  error: string; // class name only
  digest?: string;
}

/** Same scope as the API-request denominator: handler errors on customer API
 *  routes only (not health, cron or admin routes, not page renders). */
export function countsTowardApiErrorRate(e: Pick<ServerErrorEntry, "route" | "routeType">): boolean {
  if (e.routeType !== "route" || !e.route.startsWith("/api/")) return false;
  return !["/api/health", "/api/cron/", "/api/ops/"].some((p) => (p.endsWith("/") ? e.route.startsWith(p) : e.route === p || e.route.startsWith(`${p}/`)));
}

export function recordServerError(e: Omit<ServerErrorEntry, "ts">, now = Date.now()): Promise<void> {
  const entry: ServerErrorEntry = {
    ts: new Date(now).toISOString(),
    route: e.route.slice(0, 120),
    routeType: e.routeType.slice(0, 20),
    method: e.method.slice(0, 10),
    error: (/^[A-Za-z_$][\w$]{0,60}$/.test(e.error) ? e.error : "Error"),
    ...(e.digest ? { digest: String(e.digest).slice(0, 40) } : {}),
  };
  return safely(
    Promise.all([
      // Only handler errors count toward the API error RATE (its denominator is
      // API requests); render errors still appear in the list.
      countsTowardApiErrorRate(entry) ? kvIncrBy(`${ERR_PREFIX}${hourStamp(now)}`, 1, RETENTION_SECONDS) : null,
      kvListPush(ERROR_LIST, JSON.stringify(entry), ERROR_LIST_MAX),
    ])
  );
}

// One PFADD per (user, day, country) per isolate: repeat requests from the same
// signed-in user cost nothing after the first. Bounded so a long-lived isolate
// cannot grow it without limit.
const seen = new Set<string>();
const SEEN_MAX = 20_000;

export function recordActiveCountry(userId: string, country: string | null, now = Date.now()): Promise<void> | null {
  if (!country || !/^[A-Z]{2}$/.test(country) || country === "XX") return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const mark = `${day}|${country}|${userId}`;
  if (seen.has(mark)) return null;
  if (seen.size >= SEEN_MAX) seen.clear();
  seen.add(mark);
  return safely(
    Promise.all([
      kvPfAddTtl(geoKey(day, country), RETENTION_SECONDS, userId),
      kvZAdd(geoCountriesAllKey, now, country),
    ])
  );
}

// ── Request classification ────────────────────────────────────────────────────
//
// "API requests" on the dashboard means CUSTOMER-FACING API traffic:
//   counted   any method except HEAD/OPTIONS on /api/*
//   excluded  /api/health (ALB target health checks hit the task directly),
//             /api/cron/* (scheduled jobs, not customers),
//             /api/ops/* (the admin console, including this dashboard's polling)
// "Page views" means a document or client-side navigation by a likely human:
//   counted   GET of an app route (not /api, not /_next, not a file)
//   excluded  prefetches (next-router-prefetch / Sec-Purpose: prefetch),
//             known bots and clients with no User-Agent, and the admin
//             surfaces /analytics and /ops
// CDN-served static assets never reach the application and are never counted.

export type RequestClass = { kind: "api" } | { kind: "page" } | { kind: "excluded"; reason: string };

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|httpclient|okhttp|go-http-client|java\//i;
const API_EXCLUDED = ["/api/health", "/api/cron/", "/api/ops/"];
const PAGE_EXCLUDED = ["/analytics", "/ops", "/_next", "/api"];

export function classifyRequest(req: { method: string; nextUrl: { pathname: string }; headers: Headers }): RequestClass {
  const path = req.nextUrl.pathname;
  const method = req.method.toUpperCase();
  if (method === "HEAD" || method === "OPTIONS") return { kind: "excluded", reason: "method" };
  if (path.startsWith("/api/") || path === "/api") {
    return API_EXCLUDED.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)))
      ? { kind: "excluded", reason: "internal_api" }
      : { kind: "api" };
  }
  if (method !== "GET") return { kind: "excluded", reason: "method" };
  if (PAGE_EXCLUDED.some((p) => path === p || path.startsWith(`${p}/`))) return { kind: "excluded", reason: "internal_page" };
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return { kind: "excluded", reason: "asset" };
  const h = req.headers;
  if (h.get("next-router-prefetch") || /prefetch/i.test(h.get("sec-purpose") ?? h.get("purpose") ?? "")) {
    return { kind: "excluded", reason: "prefetch" };
  }
  const ua = h.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return { kind: "excluded", reason: "bot" };
  return { kind: "page" };
}

// ── Page views and unique visitors ────────────────────────────────────────────
//
// Cookieless, like the privacy-first analytics tools: a visitor is
// HMAC(daily salt, trusted client IP + User-Agent). The salt is derived from
// the server secret and the UTC date, so ids are unlinkable across days and
// cannot be reversed to an IP. Consequences, stated rather than hidden:
//   - unique visitors are exact-ish PER DAY (HyperLogLog, ~1% error) and the
//     dashboard reports the per-day series, never a cross-day "unique" figure
//   - there are no sessions: a session needs a client identifier (a cookie),
//     which needs consent; sessions are reported as not tracked
//   - two people behind one NAT with the same browser build count once.
export const PV_PREFIX = "ops:web:pv:";
export const visitorsKey = (day: string) => `ops:web:visitors:${day}`;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

export async function visitorId(ip: string, userAgent: string, day: string, secret: string): Promise<string> {
  const salt = await hmacHex(secret, `visitor-salt:${day}`);
  return (await hmacHex(salt, `${ip}|${userAgent}`)).slice(0, 32);
}

export function recordPageView(ip: string | null, userAgent: string, now = Date.now(), secret = process.env.FURLPAY_SESSION_SECRET): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  return safely(
    (async () => {
      await kvIncrBy(`${PV_PREFIX}${hourStamp(now)}`, 1, RETENTION_SECONDS);
      // No trusted IP or no secret: the view is counted, the visitor is not —
      // never a guessed identity.
      if (!ip || !secret) return;
      await kvPfAddTtl(visitorsKey(day), RETENTION_SECONDS, await visitorId(ip, userAgent, day, secret));
    })()
  );
}
