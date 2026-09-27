import { createHmac, timingSafeEqual } from "crypto";
import { kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";
import type { SecuritySeverity } from "@/lib/ops/events";

// ---------------------------------------------------------------------------
// Outbound delivery for security events.
//
// THE GAP THIS CLOSES. Anomaly detection and the authority gate raise real,
// severity-rated events, and they stopped at the ops feed — persisted where
// nobody was looking. An alert nobody receives is a control that exists on paper.
//
// WHY THIS IS NOT A `fetch()` TO A WEBHOOK URL.
//
// A configurable outbound destination inside a payments backend is an SSRF
// primitive wearing a monitoring badge. Whoever can set `FURLPAY_ALERT_WEBHOOK`
// gets the server to make an authenticated request to a URL of their choosing —
// which on a cloud host means the instance metadata endpoint, internal admin
// services, and anything else reachable from inside the perimeter but not from
// outside it. So the destination is validated before it is ever called, and the
// rules are deliberately strict rather than clever.
//
// WHAT IS DELIBERATELY NOT CLAIMED. This implements the DELIVERY MECHANISM. It
// does not make paging real: that needs a routing key or SIEM endpoint and an
// on-call rotation, neither of which lives in a repository. With no destination
// configured the sink is a no-op that says so once at startup — not a silent
// failure, and not a placeholder URL that 404s forever while looking configured.
// ---------------------------------------------------------------------------

export interface SecurityAlert {
  /** Stable event id — also the idempotency key. */
  id: string;
  kind: string;
  severity: SecuritySeverity;
  /** Human-readable. MUST already be free of customer data. */
  detail: string;
  actor: string;
  ts: string;
}

export type DeliveryOutcome =
  | { delivered: true; status: number }
  | { delivered: false; reason: "not_configured" | "duplicate" | "below_threshold" | "refused" | "failed"; detail?: string };

/**
 * Severities worth waking someone for.
 *
 * `info` and `low` stay in the feed. A sink that forwards everything trains its
 * recipients to ignore it, which is the same outcome as not having one.
 */
const DELIVERABLE: ReadonlySet<SecuritySeverity> = new Set(["high", "critical"]);

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
/** An event id may only be delivered once in this window. */
const DEDUPE_TTL_SECONDS = 3600;

/**
 * Hosts and addresses an alert may never be sent to.
 *
 * Denies by SHAPE rather than by a list of known-bad names, because the list of
 * internal services is unknowable from here and grows. The cloud metadata
 * addresses are called out individually because they are the highest-value SSRF
 * targets on every major host and they are not caught by the private-range rules
 * on all of them (169.254.169.254 is link-local, but fd00:ec2::254 is not
 * obviously private to a naive check).
 */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "fd00:ec2::254",
  "100.100.100.200", // Alibaba
]);

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // malformed → refuse
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local
  if (h.startsWith("fe80")) return true; // link-local

  // ── IPv4-MAPPED ADDRESSES ────────────────────────────────────────────────
  //
  // `https://[::ffff:10.0.0.1]/` is 10.0.0.1 wearing IPv6 syntax, and it must
  // fail the v4 rules. The trap: WHATWG URL NORMALISES THE DOTTED FORM TO HEX.
  //
  //     new URL("https://[::ffff:10.0.0.1]/").hostname === "[::ffff:a00:1]"
  //
  // So a check written against the dotted quad — which is how the address is
  // written and how anyone would test it by hand — never matches what the parser
  // actually hands you. The first version of this function had exactly that bug
  // and accepted 10.0.0.1 as a public destination. Both spellings are handled,
  // because another runtime may not normalise.
  const dotted = /^(?:0*:)*0*:?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return isPrivateIPv4(dotted[1]);

  const hex = /^(?:0*:)*0*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const quad = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPrivateIPv4(quad);
  }

  // Deprecated IPv4-COMPATIBLE form (::a00:1). Same reachability, no ffff marker.
  const compat = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (compat) {
    const high = parseInt(compat[1], 16);
    const low = parseInt(compat[2], 16);
    return isPrivateIPv4(`${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`);
  }

  return false;
}

export type DestinationCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Is this a destination we are willing to call?
 *
 * Exported for testing because it is the actual security control here — the
 * fetch is plumbing. Every rule below is a refusal, and the default is refusal:
 * an address this function cannot confidently classify as external is rejected
 * rather than attempted.
 */
export function checkDestination(raw: string | undefined): DestinationCheck {
  if (!raw || !raw.trim()) return { ok: false, reason: "no destination configured" };

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "destination is not a valid URL" };
  }

  // HTTPS only. An alert carries severity, actor and a description of a security
  // incident; sending it in clear text hands an attacker on the path a live feed
  // of which of their actions were noticed.
  if (url.protocol !== "https:") {
    return { ok: false, reason: `protocol ${url.protocol} refused — https only` };
  }

  // No credentials in the URL. They would be logged by every proxy in between,
  // and a secret belongs in the signing key, not the address.
  if (url.username || url.password) {
    return { ok: false, reason: "destination must not embed credentials" };
  }

  const host = url.hostname.toLowerCase();

  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: "cloud metadata endpoint refused" };
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "loopback/mDNS destination refused" };
  }
  // `.internal` covers GCP; `.internal`/`.ec2.internal` covers AWS VPC DNS.
  if (host.endsWith(".internal") || host.endsWith(".intranet")) {
    return { ok: false, reason: "internal DNS suffix refused" };
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, reason: "private/link-local address refused" };
  }
  // A bare hostname with no dot cannot be a public FQDN; it resolves through
  // internal search domains, which is exactly the reachability we refuse.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, reason: "unqualified hostname refused" };
  }

  return { ok: true, url };
}

/**
 * Signs the body so the receiver can prove it came from us.
 *
 * Without this, anyone who learns the webhook URL can post fabricated security
 * alerts into the channel — including a flood designed to bury a real one.
 */
export function signAlert(body: string, secret: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Constant-time verification, for the receiving end and for tests. */
export function verifyAlertSignature(
  body: string,
  secret: string,
  timestamp: string,
  signature: string
): boolean {
  const expected = Buffer.from(signAlert(body, secret, timestamp), "utf8");
  const given = Buffer.from(signature ?? "", "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The transport. Swappable so tests are deterministic and offline.
 *
 * Defaults to `fetch`. A test-only override is safer than a global mock because
 * the production path stays exactly the code that ships.
 */
export type AlertTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ status: number }>;

let transport: AlertTransport | null = null;

/** Test seam. Pass null to restore the real transport. */
export function setAlertTransport(t: AlertTransport | null): void {
  transport = t;
}

async function send(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (transport) {
      return await transport(url, { method: "POST", headers, body, signal: controller.signal });
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      // No redirects. A 302 to 169.254.169.254 would walk straight past every
      // check in `checkDestination`, which only ever saw the original URL.
      redirect: "manual",
    });
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

let warnedUnconfigured = false;

/**
 * Deliver one alert. Never throws.
 *
 * NON-BLOCKING BY CONTRACT. Callers are security-critical paths — a statutory
 * disclosure, a role change — and none of them may fail because a monitoring
 * webhook is down. Every failure mode returns a verdict instead of propagating,
 * and the event is already persisted locally before this is ever called.
 */
export async function deliverSecurityAlert(alert: SecurityAlert): Promise<DeliveryOutcome> {
  if (!DELIVERABLE.has(alert.severity)) {
    return { delivered: false, reason: "below_threshold" };
  }

  const destination = checkDestination(process.env.FURLPAY_ALERT_WEBHOOK);
  const secret = process.env.FURLPAY_ALERT_WEBHOOK_SECRET;

  if (!destination.ok) {
    // Said ONCE, not per event. A repeated warning in a hot path is noise that
    // trains people to filter the logger.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      log.warn("Security alert sink is not delivering", { reason: destination.reason });
    }
    return {
      delivered: false,
      reason: destination.reason === "no destination configured" ? "not_configured" : "refused",
      detail: destination.reason,
    };
  }

  if (!secret || secret.length < 16) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      log.warn("Security alert sink refuses to send unsigned alerts", {
        reason: "FURLPAY_ALERT_WEBHOOK_SECRET missing or too short",
      });
    }
    // Refusing beats sending unsigned. An unsigned feed the receiver trusts is
    // a channel an attacker can write to.
    return { delivered: false, reason: "refused", detail: "signing secret unset" };
  }

  // IDEMPOTENT. `recordSecurityEvent` may be reached twice for one incident on a
  // retry or a duplicated lambda invocation, and a pager that fires twice for
  // one event is how responders learn to ignore it. The event id is the key.
  const first = await kvSetNx(`alert:sent:${alert.id}`, 1, DEDUPE_TTL_SECONDS).catch(() => true);
  if (!first) return { delivered: false, reason: "duplicate" };

  // The payload carries severity, kind, actor and a pre-sanitised description —
  // never a customer record. `detail` is written by the raising site, and the
  // anomaly detector's own tests assert it excludes even opaque resource refs.
  const body = JSON.stringify({
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    detail: alert.detail,
    actor: alert.actor,
    ts: alert.ts,
    source: "furlpay",
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { status } = await send(
        destination.url.toString(),
        {
          "content-type": "application/json",
          "x-furlpay-timestamp": timestamp,
          "x-furlpay-signature": signAlert(body, secret, timestamp),
        },
        body
      );

      if (status >= 200 && status < 300) return { delivered: true, status };

      // 4xx is our fault and will not improve by repeating — a bad URL, a
      // rejected signature, a disabled channel. Retrying it is a retry storm
      // against a destination that has already said no.
      if (status >= 400 && status < 500) {
        return { delivered: false, reason: "failed", detail: `status ${status}` };
      }
      lastDetail = `status ${status}`;
    } catch (e) {
      lastDetail = e instanceof Error ? e.name : "network error";
    }

    // Bounded, and short. This runs inline with a security action; a long
    // backoff would hold a compliance request open waiting for a pager.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }

  log.warn("Security alert delivery failed", { kind: alert.kind, detail: lastDetail });
  return { delivered: false, reason: "failed", detail: lastDetail };
}

/** Test helper — resets the once-only warning latch. */
export function resetAlertSinkWarning(): void {
  warnedUnconfigured = false;
}
