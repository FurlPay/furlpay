// URL minimisation for Vercel Web Analytics.
//
// Runs inside the SDK's beforeSend hook, which the delivered script calls
// BEFORE it builds the request (verified in /_vercel/insights/script.js: the
// URL it transmits is the one beforeSend returns, and `null` sends nothing).
// So this is a transport control, not a dashboard filter.
//
// What it does, and why:
//   - drops the query string and fragment entirely. Page URLs on this site
//     carry Stripe checkout session ids (/pricing?session_id=), email
//     addresses (/ambassadors/dashboard?email=), and one-time codes. An
//     allowlist of "safe" params is not worth the risk for aggregate stats.
//   - redacts record ids in paths: /support/[id] and /travel/booking/[id]
//     identify a person's ticket or booking.
//   - redacts any path segment that looks like an identifier rather than a
//     page name (UUID, email, long hex/base64/digit run), so a future route
//     that puts an id in the path is covered before anyone remembers it.
//   - returns null (send nothing) when the URL cannot be parsed. Failing
//     closed loses one pageview; failing open could send anything.
//
// It does NOT cover the referrer: the script sends an EXTERNAL referrer
// (never one from this host) outside beforeSend. See
// docs/analytics/VERCEL_ANALYTICS_AUDIT.md.

export const REDACTED = "[redacted]";

/** Routes whose dynamic segment is a person's record. Index = segment position. */
const RECORD_ROUTES: { prefix: string[]; idIndex: number }[] = [
  { prefix: ["support"], idIndex: 1 },
  { prefix: ["travel", "booking"], idIndex: 2 },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAILISH = /@|%40/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const LONG_DIGITS = /^\d{8,}$/;
// Token-shaped: 20+ chars of base64url with at least one digit and one letter,
// and no hyphen-separated words (slugs like "how-to-pay-with-usdc" stay).
const TOKENISH = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_]{20,}$/;

function looksLikeIdentifier(segment: string): boolean {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    return true; // malformed escape: treat as opaque
  }
  return UUID.test(s) || EMAILISH.test(s) || LONG_HEX.test(s) || LONG_DIGITS.test(s) || TOKENISH.test(s);
}

/** origin + minimised path, or null when nothing safe can be produced. */
export function sanitizeAnalyticsUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const lower = segments.map((s) => s.toLowerCase());
  for (const { prefix, idIndex } of RECORD_ROUTES) {
    if (segments.length > idIndex && prefix.every((p, i) => lower[i] === p)) {
      segments[idIndex] = REDACTED;
    }
  }
  const path = segments.map((s) => (s === REDACTED || !looksLikeIdentifier(s) ? s : REDACTED)).join("/");
  return `${url.origin}/${path}`;
}
