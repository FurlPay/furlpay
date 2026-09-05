import Constants from "expo-constants";
import { Platform } from "react-native";
import { isDeniedKey, scrubString, scrubUrl, scrubValue } from "./scrub";

// ---------------------------------------------------------------------------
// Mobile observability.
//
// Provider-agnostic on purpose. The app talks to THIS module; a transport
// adapter talks to the vendor. Two reasons that boundary is worth its weight:
//
//   1. The PII scrubbing in ./scrub.ts is enforced in one place, on the way
//      out, for every transport. A vendor SDK wired directly into 55 screens
//      has 55 places to forget.
//   2. @sentry/react-native has a NATIVE layer. It cannot be added and verified
//      without an Android build, and this codebase is developed on Windows
//      without an attached device. Rather than ship an unverified native
//      dependency, the Sentry adapter loads dynamically IF the package is
//      installed, and everything here works without it.
//
// See ./README.md for the exact install + env vars needed to turn the vendor
// transport on.
// ---------------------------------------------------------------------------

export type Environment = "development" | "staging" | "production";

export type Severity = "debug" | "info" | "warning" | "error" | "fatal";

export interface Breadcrumb {
  category: "navigation" | "http" | "auth" | "money" | "ui" | "lifecycle";
  message: string;
  level?: Severity;
  data?: Record<string, unknown>;
  timestamp: number;
}

/**
 * A transport. Implement this to send somewhere; everything reaching it has
 * ALREADY been scrubbed.
 */
export interface Transport {
  name: string;
  captureException(error: Error, context: Record<string, unknown>): void;
  captureMessage(message: string, level: Severity, context: Record<string, unknown>): void;
  addBreadcrumb(crumb: Breadcrumb): void;
  setUser(id: string | null): void;
  startSpan?(name: string, op: string): { finish: (status?: string) => void };
}

// --- environment ------------------------------------------------------------

export function currentEnvironment(): Environment {
  const explicit = process.env.EXPO_PUBLIC_FURLPAY_ENV;
  if (explicit === "production" || explicit === "staging" || explicit === "development") {
    return explicit;
  }
  // __DEV__ is the Metro dev bundle. A release build with no explicit env is
  // treated as production — the conservative choice, because the alternative
  // is a production build reporting into the staging project where nobody is
  // watching the alerts.
  return __DEV__ ? "development" : "production";
}

export const release = `${Constants.expoConfig?.version ?? "0.0.0"}+${
  Constants.expoConfig?.android?.versionCode ?? 0
}`;

// --- state ------------------------------------------------------------------

const transports: Transport[] = [];
const breadcrumbs: Breadcrumb[] = [];
const MAX_BREADCRUMBS = 50;
let enabled = true;

export function registerTransport(t: Transport): void {
  if (transports.some((x) => x.name === t.name)) return;
  transports.push(t);
}

/** Kill switch. Used by the privacy settings and by tests. */
export function setObservabilityEnabled(on: boolean): void {
  enabled = on;
}

export function isObservabilityEnabled(): boolean {
  return enabled;
}

// --- reporting --------------------------------------------------------------

function baseContext(): Record<string, unknown> {
  return {
    environment: currentEnvironment(),
    release,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
  };
}

/**
 * Record something that happened, for context on a later error.
 *
 * Breadcrumbs are the highest-risk surface here — they are recorded constantly
 * and casually — so `data` is scrubbed on the way IN rather than only on the
 * way out. A breadcrumb that is never sent still sits in memory, and an error
 * report is not the only way memory escapes a process.
 */
export function addBreadcrumb(
  category: Breadcrumb["category"],
  message: string,
  data?: Record<string, unknown>
): void {
  if (!enabled) return;
  const crumb: Breadcrumb = {
    category,
    message: scrubString(message),
    timestamp: Date.now(),
    data: data ? (scrubValue(data) as Record<string, unknown>) : undefined,
  };
  breadcrumbs.push(crumb);
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
  for (const t of transports) t.addBreadcrumb(crumb);
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");

  const scrubbed: Record<string, unknown> = {
    ...baseContext(),
    ...(context ? (scrubValue(context) as Record<string, unknown>) : {}),
  };
  // The message itself is prose and can carry an address or an email.
  const safe = new Error(scrubString(err.message));
  safe.name = err.name;
  safe.stack = err.stack ? scrubString(err.stack) : undefined;

  for (const t of transports) t.captureException(safe, scrubbed);
  if (__DEV__) console.warn(`[observability] ${safe.name}: ${safe.message}`, scrubbed);
}

export function captureMessage(
  message: string,
  level: Severity = "info",
  context?: Record<string, unknown>
): void {
  if (!enabled) return;
  const scrubbed = {
    ...baseContext(),
    ...(context ? (scrubValue(context) as Record<string, unknown>) : {}),
  };
  for (const t of transports) t.captureMessage(scrubString(message), level, scrubbed);
}

/**
 * Associate reports with an account.
 *
 * The id is HASHED, not sent. A support engineer needs to know that fourteen
 * crashes came from one account; they do not need to be able to look that
 * account up, and the vendor certainly does not. `null` clears it on sign-out.
 */
export function setUser(accountId: string | null): void {
  if (!accountId) {
    for (const t of transports) t.setUser(null);
    return;
  }
  // Non-cryptographic, stable, one-way enough for correlation. Deliberately not
  // reversible to an account id by anyone holding only the report.
  let h = 0;
  for (let i = 0; i < accountId.length; i++) {
    h = (Math.imul(31, h) + accountId.charCodeAt(i)) | 0;
  }
  const pseudonym = `u_${(h >>> 0).toString(36)}`;
  for (const t of transports) t.setUser(pseudonym);
}

// --- performance ------------------------------------------------------------

export interface Span {
  finish(status?: "ok" | "error" | "cancelled"): void;
}

const NOOP_SPAN: Span = { finish: () => {} };

/**
 * Time an operation.
 *
 * Returns a no-op span when nothing is listening, so call sites can be written
 * unconditionally without a null check around every measurement.
 */
export function startSpan(name: string, op: "navigation" | "http" | "startup" | "db"): Span {
  if (!enabled) return NOOP_SPAN;
  const started = Date.now();
  const children = transports.map((t) => t.startSpan?.(name, op)).filter(Boolean);
  return {
    finish(status = "ok") {
      const ms = Date.now() - started;
      for (const c of children) c!.finish(status);
      // Always leave a breadcrumb, even with no transport attached: a slow
      // operation is context for whatever fails next.
      addBreadcrumb("ui", `${op}:${name}`, { ms, status });
    },
  };
}

/** Instrument a fetch-like call. URL is route-normalized, never sent raw. */
export function recordHttp(
  url: string,
  method: string,
  status: number | null,
  ms: number,
  error?: unknown
): void {
  addBreadcrumb("http", `${method} ${scrubUrl(url)}`, {
    status,
    ms,
    ok: status !== null && status >= 200 && status < 400,
  });
  if (error) {
    captureException(error, { url: scrubUrl(url), method, status, ms });
  }
}

export { scrubString, scrubUrl, scrubValue, isDeniedKey };
