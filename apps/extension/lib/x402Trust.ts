import type { X402Detection, X402Requirement } from "./types";

// The trust boundary for x402 detections.
//
// x402-main runs in the MAIN world so it can patch the page's fetch/XHR. That
// world shares the page's window, which means the relay to the isolated world —
// window.postMessage — is a channel the page can also write to. A page script
// can post a byte-identical message, and `event.source === window` cannot tell
// the two apart, because both genuinely are this window.
//
// So a detection is never evidence of a server 402. It is a claim made by the
// site. Everything here exists to bound that claim: shape-check it, refuse
// anything that is not a re-fetchable web resource, and strip the fields that
// would otherwise let a page name its own payment recipient.

/** Longest resource URL we will carry. Bounds what a hostile page can push
 *  through postMessage and into a tab URL. */
const MAX_URL_LENGTH = 2048;

/** x402 servers may advertise several acceptable payment methods. More than a
 *  handful is not a real server describing its prices. */
const MAX_REQUIREMENTS = 8;

/**
 * Narrows an untrusted value to an HTTPS URL string.
 *
 * A payment journey must not begin over cleartext HTTP: an active network
 * attacker could rewrite the 402 before FurlPay's server gets a chance to
 * re-fetch and verify it. `javascript:`, `data:`, `file:` and HTTP are all
 * rejected rather than handed to `tabs.create` or rendered.
 *
 * @param raw Value claimed by the page to be a resource URL.
 * @returns The normalised URL, or `null` when it is not usable.
 */
export function httpsResourceOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const MAX_REQUIREMENT_TEXT_LENGTH = 256;
const MAX_ATOMIC_AMOUNT_LENGTH = 40;

function boundedText(value: unknown, max = MAX_REQUIREMENT_TEXT_LENGTH): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** Keep only bounded primitive fields the extension can safely display. The
 * MAIN-world relay is writable by the page, so retaining raw nested objects in
 * extension storage would make a 402 detection a page-controlled data sink. */
function sanitizeRequirements(raw: unknown): X402Requirement[] {
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, MAX_REQUIREMENTS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const input = candidate as Record<string, unknown>;
    const maxAmountRequired = boundedText(input.maxAmountRequired, MAX_ATOMIC_AMOUNT_LENGTH);
    const amountUsd = input.amountUsd;
    const requirement: X402Requirement = {
      ...(boundedText(input.scheme) ? { scheme: boundedText(input.scheme) } : {}),
      ...(boundedText(input.network) ? { network: boundedText(input.network) } : {}),
      ...(boundedText(input.asset) ? { asset: boundedText(input.asset) } : {}),
      ...(boundedText(input.payTo) ? { payTo: boundedText(input.payTo) } : {}),
      ...(maxAmountRequired && /^\d+$/.test(maxAmountRequired) ? { maxAmountRequired } : {}),
      ...(typeof amountUsd === "number" && Number.isFinite(amountUsd) && amountUsd >= 0 && amountUsd <= 1_000_000_000
        ? { amountUsd }
        : {}),
      ...(boundedText(input.description) ? { description: boundedText(input.description) } : {}),
    };
    return [requirement];
  });
}

/**
 * Shape-checks a detection posted by the page.
 *
 * This is not authentication — a page can always post a well-formed detection,
 * and no check here can change that. It bounds what the overlay will render and
 * what the background is asked to act on.
 *
 * @param raw The `detection` field of a `furlpay-x402-detected` message.
 * @returns A bounded detection, or `null` when it is unusable.
 */
export function sanitizeDetection(raw: unknown): X402Detection | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  const url = httpsResourceOrNull(d.url);
  if (!url) return null;

  return {
    url,
    method:
      typeof d.method === "string" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(d.method)
        ? d.method.toUpperCase()
        : "GET",
    requirements: sanitizeRequirements(d.requirements),
    detectedAt:
      typeof d.detectedAt === "string" ? d.detectedAt.slice(0, 64) : new Date().toISOString(),
  } as X402Detection;
}

/**
 * Builds the query for the furlpay.com checkout deep link.
 *
 * `payTo` and `maxAmountRequired` are deliberately absent. Forwarding them let
 * any site pop a FurlPay payment prompt naming an attacker's recipient, since
 * the values only ever came from the page. Only the resource goes through, and
 * furlpay.com re-fetches the 402 to establish the real recipient and amount.
 *
 * @param detection A detection that has already been through `sanitizeDetection`.
 * @param origin The page origin from `sender` — the browser sets it, so unlike
 *               everything in `detection` the page cannot forge it. `null` when
 *               it could not be determined.
 * @returns Params carrying the resource and, when known, the asking origin.
 */
export function checkoutParams(detection: X402Detection, origin: string | null): URLSearchParams {
  const params = new URLSearchParams({ resource: detection.url });
  if (origin) params.set("origin", origin);
  return params;
}
