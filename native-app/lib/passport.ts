import * as WebBrowser from "expo-web-browser";
import { api } from "./api";

import type { DocumentStatus } from "@/components/PassportCard";

// ---------------------------------------------------------------------------
// Passport and Travel Document management — the native client for /api/passport.
//
// WHY THERE IS NO DOCUMENT UPLOAD HERE, AND NEVER SHOULD BE.
//
// The obvious mobile design is a camera screen that captures a passport
// and POSTs it to our API. Do not build that. The moment a government
// ID photo touches this app's memory, our servers, our logs or
// our backups, it is in scope for every biometric-data regime that applies to
// the user — and we would be storing exactly the material an attacker wants
// most, to do a job a specialist provider already does better.
//
// Instead the provider's hosted flow runs in a browser session. The document
// goes from the camera straight to the provider over their own
// TLS session. We never see it. What we get back is a session identifier,
// which is all the ledger of record needs.
//
// WHY openAuthSessionAsync AND NOT A WEBVIEW. An in-app WebView is a hostile
// place to ask someone for a passport: the app process can read its cookies and
// inject JavaScript, so neither the user nor the provider can trust what is
// running. openAuthSessionAsync uses the system browser (Custom Tabs on
// Android), which is out of this app's reach, shows the real URL and padlock,
// and is what the provider's fraud tooling expects to see. It also gives us the
// deep-link return for free.
//
// The server, not this file, decides the verification outcome and status.
// A client that chose its own outcome would be a client an attacker can
// reconfigure.
// ---------------------------------------------------------------------------

/**
 * TravelDocumentView represents a travel document as returned by the API.
 */
export interface TravelDocumentView {
  id: string;
  type: string;
  typeLabel: string;
  issuingCountry: string;
  countryName: string;
  documentNumberMasked: string;
  expiresOn: string;
  expiringSoon: boolean;
  expired: boolean;
  status: DocumentStatus;
  chipVerified: boolean;
  label: string | null;
  isPrimary: boolean;
}

export interface PassportScanSession {
  sessionId: string;
  /** Provider-hosted URL. Opened in the system browser, never in a WebView. */
  sessionUrl: string;
  documentFormat: string;
}

/**
 * How a verification attempt ended.
 *
 * `submitted` is deliberately not `approved`. The browser closing tells us the
 * user finished the flow, nothing more — the provider decides the outcome
 * asynchronously and tells the SERVER. Treating a closed browser as an approval
 * would let anyone verify documents by dismissing a screen.
 */
export type PassportVerifyOutcome =
  | { status: "submitted"; sessionId: string }
  | { status: "dismissed"; sessionId: string }
  | { status: "unavailable"; reason: string };

/**
 * Fetch all travel documents for the current user.
 */
export async function fetchDocuments(): Promise<{ documents: TravelDocumentView[] }> {
  return api<{ documents: TravelDocumentView[] }>("/passport");
}

/**
 * Ask the server to open an inquiry with the configured identity provider
 * for a travel document.
 */
export async function initDocumentScan(
  issuingCountry: string,
  documentType: string
): Promise<PassportScanSession> {
  return api<PassportScanSession>("/passport", {
    method: "POST",
    body: { issuingCountry, documentType },
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
export async function runDocumentFlow(
  session: PassportScanSession,
  returnUrl?: string
): Promise<PassportVerifyOutcome> {
  try {
    const result = returnUrl
      ? await WebBrowser.openAuthSessionAsync(session.sessionUrl, returnUrl)
      : await WebBrowser.openBrowserAsync(session.sessionUrl).then(() => ({ type: "dismiss" as const }));

    return result.type === "success"
      ? { status: "submitted", sessionId: session.sessionId }
      : { status: "dismissed", sessionId: session.sessionId };
  } catch (e) {
    return { status: "unavailable", reason: (e as Error).message };
  }
}

/**
 * Complete the verification process using the token returned by the hosted flow.
 */
export async function completeVerification(sessionId: string): Promise<TravelDocumentView> {
  // The server returns { document }, not a bare document. Unwrapping HERE
  // rather than asserting the wrong shape is the difference between a card
  // that renders and one whose every field is undefined — `api<T>()` is a type
  // assertion, so TypeScript cannot catch a mismatch like that for us.
  const res = await api<{ document: TravelDocumentView }>("/passport/verify", {
    method: "POST",
    body: { sessionId },
  });
  return res.document;
}

/**
 * Fetch the latest status for a specific document from the server.
 */
export async function fetchDocumentStatus(documentId: string): Promise<TravelDocumentView> {
  const res = await api<{ document: TravelDocumentView }>(
    `/passport/status?documentId=${encodeURIComponent(documentId)}`
  );
  return res.document;
}

/**
 * Update user-configurable fields on a travel document.
 */
export async function updateDocument(
  id: string,
  updates: { label?: string; isPrimary?: boolean }
): Promise<TravelDocumentView> {
  const res = await api<{ document: TravelDocumentView }>(
    `/passport/${encodeURIComponent(id)}`,
    { method: "PATCH", body: updates }
  );
  return res.document;
}

/**
 * Delete a travel document.
 */
export async function deleteDocument(id: string): Promise<void> {
  return api(`/passport/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: { confirmation: "DELETE" },
  });
}
