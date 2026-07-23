import * as WebBrowser from "expo-web-browser";
import { api } from "./api";
import type { Overview } from "./types";

// ---------------------------------------------------------------------------
// Identity verification (KYC) — the native client for POST /api/compliance/verify.
//
// WHY THERE IS NO DOCUMENT UPLOAD HERE, AND NEVER SHOULD BE.
//
// The obvious mobile design is a camera screen that captures a passport and a
// selfie and POSTs them to our API. Do not build that. The moment a government
// ID photo or a face scan touches this app's memory, our servers, our logs or
// our backups, it is in scope for every biometric-data regime that applies to
// the user — and we would be storing exactly the material an attacker wants
// most, to do a job a specialist provider already does better.
//
// Instead the provider's hosted flow runs in a browser session. The document
// and the selfie go from the camera straight to the provider over their own
// TLS session. We never see them. What we get back is a decision and an
// inquiry id, which is all the ledger of record needs.
//
// WHY openAuthSessionAsync AND NOT A WEBVIEW. An in-app WebView is a hostile
// place to ask someone for a passport: the app process can read its cookies and
// inject JavaScript, so neither the user nor the provider can trust what is
// running. openAuthSessionAsync uses the system browser (Custom Tabs on
// Android), which is out of this app's reach, shows the real URL and padlock,
// and is what the provider's fraud tooling expects to see. It also gives us the
// deep-link return for free.
//
// The server, not this file, decides which documents and checks a country
// requires (lib/compliance/ruleEngine.ts) and refuses blocked jurisdictions.
// A client that chose its own requirements would be a client an attacker can
// reconfigure.
// ---------------------------------------------------------------------------

/** What the server requires for this user's jurisdiction. Display only. */
export interface VerificationRequirements {
  requiredDocs: string[];
  requiredChecks: string[];
  /** Enhanced due diligence — the flow will ask for more than the basics. */
  eddRequired: boolean;
}

export interface VerificationSession extends VerificationRequirements {
  sessionId: string;
  /** Provider-hosted URL. Opened in the system browser, never in a WebView. */
  sessionUrl: string;
}

/**
 * How a verification attempt ended.
 *
 * `submitted` is deliberately not `approved`. The browser closing tells us the
 * user finished the flow, nothing more — the provider decides the outcome
 * asynchronously and tells the SERVER over a signed webhook
 * (/api/webhooks/persona, /api/webhooks/complyadvantage). Treating a closed
 * browser as an approval would let anyone grant themselves a verified tier by
 * dismissing a screen.
 */
export type VerificationOutcome =
  | { status: "submitted"; sessionId: string }
  | { status: "dismissed"; sessionId: string }
  | { status: "unavailable"; reason: string };

/** ISO 3166-1 alpha-2, which is what the server's Zod schema requires. */
function normalizeCountry(country: string): string {
  return country.trim().toUpperCase().slice(0, 2);
}

/**
 * Ask the server to open an inquiry with the configured identity provider.
 *
 * Throws ApiError(403) when the jurisdiction is blocked and ApiError(401) when
 * the session is not valid — both decided server-side. This route authenticates
 * via `Authorization: Bearer`, which api() already attaches.
 */
export async function startVerification(
  country: string,
  referenceId?: string
): Promise<VerificationSession> {
  return api<VerificationSession>("/compliance/verify", {
    method: "POST",
    body: { country: normalizeCountry(country), ...(referenceId ? { referenceId } : {}) },
  });
}

/**
 * Run the hosted flow and report how it ended.
 *
 * `returnUrl` should be this app's deep link so the browser hands control back
 * when the provider redirects. Without it the session still works — the user
 * closes the tab manually and we report `dismissed`, which is honest but a
 * worse experience.
 */
export async function runVerificationFlow(
  session: VerificationSession,
  returnUrl?: string
): Promise<VerificationOutcome> {
  try {
    const result = returnUrl
      ? await WebBrowser.openAuthSessionAsync(session.sessionUrl, returnUrl)
      : await WebBrowser.openBrowserAsync(session.sessionUrl).then(() => ({ type: "dismiss" as const }));

    // `success` means the provider redirected back to us; `dismiss`/`cancel`
    // mean the user closed the tab. Neither is an approval — see the note on
    // VerificationOutcome.
    return result.type === "success"
      ? { status: "submitted", sessionId: session.sessionId }
      : { status: "dismissed", sessionId: session.sessionId };
  } catch (e) {
    return { status: "unavailable", reason: (e as Error).message };
  }
}

/**
 * The status the SERVER holds for this user, which is the only status that
 * counts. Read from the account record the webhooks update; this client never
 * writes it.
 */
export async function fetchKycStatus(): Promise<{
  kycStatus: string;
  tier: string;
  /** The account's region, as the server holds it. Used to open the inquiry. */
  region: string;
}> {
  const overview = await api<Overview>("/overview");
  return {
    kycStatus: overview.user.kycStatus,
    tier: overview.user.tier,
    region: overview.user.region,
  };
}
