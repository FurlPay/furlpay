// ---------------------------------------------------------------------------
// UPI deep links (NPCI UPI Linking Specification) â€” `upi://pay?pa=â€¦`.
//
// India's merchant payments are QR-first, and every one of those QRs encodes a
// upi:// URI. Before this module the scanner understood crypto addresses and
// furlpay.com links only, so pointing the camera at a shop's QR failed with
// "no payable address" â€” the single biggest gap for an Indian user.
//
// WHAT THIS MODULE DOES AND DOES NOT DO. It parses and rebuilds the URI, and
// hands it to an installed UPI app (GPay / PhonePe / Paytm / BHIM) which does
// the actual payment. FurlPay never sees the money, never holds a mandate, and
// needs no gateway credentials or PSP licence for this flow â€” the OS and the
// user's existing bank app carry it. That is exactly why it is buildable today.
//
// SECURITY â€” WHAT A SCANNED QR CAN AND CANNOT CLAIM.
//   * `pa` (the VPA) is the ONLY field that decides where money goes.
//   * `pn` (payee name) is ATTACKER-CONTROLLED display text. A QR taped over a
//     real one can say "Starbucks" and pay anyone. UI MUST show the VPA next to
//     the name and must never present `pn` alone as the payee's identity.
//   * `am` is likewise attacker-controlled; a dynamic QR can ask for any amount,
//     so it is shown prominently and is bounded here to reject absurd values.
//   * `tn` / `tr` are free text and are length-capped and stripped of control
//     characters so they cannot forge extra lines in a confirmation screen.
//
// PARSING BY REGEX, NOT `new URL`. React Native's URL implementation is a
// polyfill with known gaps on non-special schemes (`upi:`), where host/search
// splitting differs between engines and versions. The grammar here is tiny and
// fully specified, so parsing it directly is both shorter and portable.
// ---------------------------------------------------------------------------

import { Linking, Platform } from "react-native";

export interface UpiPaymentRequest {
  /** Payee VPA, e.g. `merchant@ybl`. The only field that routes money. */
  payeeVpa: string;
  /** Payee display name from the QR â€” UNVERIFIED, show alongside the VPA. */
  payeeName: string | null;
  /** Amount in INR as a decimal string, or null for a static QR (user enters). */
  amount: string | null;
  /** Always "INR" â€” UPI settles in rupees only. */
  currency: "INR";
  /** Merchant transaction reference. */
  transactionRef: string | null;
  /** Free-text note. */
  transactionNote: string | null;
  /** ISO 18245 merchant category code, when the QR is a merchant QR. */
  merchantCode: string | null;
}

/**
 * VPA grammar. Deliberately a little more permissive than the "handle is pure
 * alpha" shape most examples use: real handles include digits and hyphens
 * (`@okhdfcbank`, `@paytm-1`), and wrongly rejecting a valid merchant VPA means
 * the user simply cannot pay. The PSP app re-validates and resolves it anyway,
 * so this is a sanity filter, not an authorisation decision.
 */
const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** Strict decimal: digits, optional 1-2 decimal places. No exponents, no commas. */
const AMOUNT_RE = /^\d{1,9}(?:\.\d{1,2})?$/;

/**
 * Upper sanity bound on a scanned amount. The PSP app enforces the real
 * per-transaction cap (which varies by bank and category), so this exists only
 * to reject a QR encoding a nonsense figure before it reaches a confirmation
 * screen â€” the same reasoning as the oracle bounds in AGENTS.md rule 8.
 */
const MAX_SCANNED_AMOUNT_INR = 1_000_000;

/** Free-text fields are capped and stripped of control characters so a crafted
 *  QR cannot inject newlines into a confirmation screen. */
function cleanText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
  return stripped ? stripped.slice(0, maxLength) : null;
}

/**
 * Parse a scanned `upi://pay?â€¦` URI. Returns null when the string is not a UPI
 * URI at all AND when it is one but is malformed â€” callers that need to tell
 * those apart should use `looksLikeUpiUri` first.
 */
export function parseUpiUri(data: string): UpiPaymentRequest | null {
  const raw = data.trim();

  // Scheme + action. Case-insensitive: QR encoders in the wild emit `UPI://PAY`.
  // The `//` authority is optional in real QRs (`upi:pay?â€¦` occurs), so both
  // spellings are accepted.
  const match = raw.match(/^upi:(?:\/\/)?pay\?(.*)$/i);
  if (!match) return null;

  const params = new URLSearchParams(match[1]);

  const payeeVpa = params.get("pa")?.trim();
  if (!payeeVpa || !VPA_RE.test(payeeVpa)) return null;

  // UPI settles in INR. A QR claiming anything else is malformed or hostile â€”
  // honouring it would render a foreign-currency figure the rails cannot pay.
  const currency = params.get("cu")?.trim().toUpperCase();
  if (currency && currency !== "INR") return null;

  // A static QR omits `am` entirely; the user supplies it. An `am` that is
  // present but unparseable is a malformed QR, not a static one â€” treating it
  // as static would silently drop an amount the merchant intended to charge.
  let amount: string | null = null;
  const rawAmount = params.get("am")?.trim();
  if (rawAmount !== undefined && rawAmount !== "") {
    if (!AMOUNT_RE.test(rawAmount)) return null;
    const value = Number(rawAmount);
    if (!(value > 0) || value > MAX_SCANNED_AMOUNT_INR) return null;
    amount = rawAmount;
  }

  return {
    payeeVpa,
    payeeName: cleanText(params.get("pn"), 128),
    amount,
    currency: "INR",
    transactionRef: cleanText(params.get("tr"), 64),
    transactionNote: cleanText(params.get("tn"), 128),
    merchantCode: cleanText(params.get("mc"), 8),
  };
}

/** True when the string is addressed to the UPI scheme, parseable or not. Lets
 *  the scanner say "that UPI QR is malformed" instead of "not payable". */
export function looksLikeUpiUri(data: string): boolean {
  return /^upi:(?:\/\/)?pay\?/i.test(data.trim());
}

/**
 * Rebuild a canonical `upi://pay?â€¦` URI for handing to a PSP app.
 *
 * `amountOverride` supplies the amount for a static QR (one that arrived with
 * none). It is validated here rather than trusted, so a UI bug cannot send an
 * empty or malformed amount to a payment app.
 */
export function buildUpiUri(
  request: UpiPaymentRequest,
  amountOverride?: string
): string {
  const amount = amountOverride ?? request.amount;
  if (amount !== null && amount !== undefined) {
    if (!AMOUNT_RE.test(amount)) throw new Error("Invalid UPI amount");
    const value = Number(amount);
    if (!(value > 0) || value > MAX_SCANNED_AMOUNT_INR) throw new Error("Invalid UPI amount");
  }

  // Built by hand rather than with URLSearchParams: the latter encodes spaces
  // as "+", which several PSP apps pass through literally into the note.
  const parts: string[] = [
    `pa=${encodeURIComponent(request.payeeVpa)}`,
    `cu=INR`,
  ];
  if (request.payeeName) parts.push(`pn=${encodeURIComponent(request.payeeName)}`);
  if (amount) parts.push(`am=${amount}`);
  if (request.transactionRef) parts.push(`tr=${encodeURIComponent(request.transactionRef)}`);
  if (request.transactionNote) parts.push(`tn=${encodeURIComponent(request.transactionNote)}`);
  if (request.merchantCode) parts.push(`mc=${encodeURIComponent(request.merchantCode)}`);

  return `upi://pay?${parts.join("&")}`;
}

// ---------------------------------------------------------------------------
// Handing the payment to an installed UPI app.
//
// ANDROID and iOS are genuinely different here, and the difference is not a
// detail that can be papered over:
//
//   Android — `upi://` is a registered intent filter that EVERY PSP app is
//   required by NPCI to listen on. ACTION_VIEW resolves to the system chooser,
//   the user picks GPay/PhonePe/Paytm, and the OS does the rest. `queries` in
//   AndroidManifest.xml is required on API 30+ for canOpenURL to see them.
//
//   iOS — there is NO universal `upi://` handler and NO system app chooser.
//   Each PSP app registers its own private scheme, so a reliable iOS flow means
//   querying each scheme via LSApplicationQueriesSchemes and presenting OUR own
//   picker. Those per-app scheme strings are NOT hardcoded here: they change
//   with each PSP's SDK, an out-of-date guess fails silently (canOpenURL simply
//   returns false), and a wrong one would send the user nowhere. They must be
//   read off each provider's current iOS integration docs and added
//   deliberately — see openUpiApp's `unsupported` result.
//
// The honest iOS behaviour until that list is verified: try the plain `upi://`
// URI (some iOS PSP builds do register it), and when that fails say so, so the
// UI can fall back to displaying the QR for the user to scan with their bank
// app directly.
// ---------------------------------------------------------------------------

export type UpiLaunchResult =
  | { ok: true }
  | { ok: false; reason: "no_upi_app" | "unsupported" | "failed" };

/**
 * Open an installed UPI app for `request`. Never throws — the caller gets a
 * reason it can render, because "nothing happened" is the worst possible
 * outcome at a shop counter.
 */
export async function openUpiApp(
  request: UpiPaymentRequest,
  amountOverride?: string
): Promise<UpiLaunchResult> {
  let uri: string;
  try {
    uri = buildUpiUri(request, amountOverride);
  } catch {
    return { ok: false, reason: "failed" };
  }

  try {
    const supported = await Linking.canOpenURL(uri);
    if (!supported) {
      // On Android this means no PSP app is installed (or `queries` is missing
      // from the manifest). On iOS it is the expected case described above.
      return { ok: false, reason: Platform.OS === "ios" ? "unsupported" : "no_upi_app" };
    }
    await Linking.openURL(uri);
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
