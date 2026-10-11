// Who may send which message to the service worker.
//
// `sender.id === browser.runtime.id` is true for every surface of this
// extension, including the content scripts that run on every HTTPS page. The
// static test in __tests__/contentScriptBoundary.test.ts pins that no content
// script *source* forwards a privileged type, but source is not a runtime
// boundary: Chrome's threat model treats a content script as compromised when
// its renderer is (a renderer exploit on any open page owns the isolated world
// too). From there, every handler in background.ts — REVOKE_PASSKEY, LOGOUT,
// STEP_UP_SEND, DECLINE_CHALLENGE, RAMP_CHECKOUT — was one sendMessage away.
//
// So the worker classifies the sender and enforces the split itself:
//   - extension pages (popup, side panel, devtools, connect prompt) — sender.url
//     is on this extension's own origin, which a web renderer cannot claim;
//   - content scripts — anything else; limited to CONTENT_SCRIPT_MESSAGES.
// WALLET_CONNECT_DECISION is narrower still: only the connect-prompt page may
// answer a consent prompt, so no other surface can approve a dapp.

/** The only types a content script may send. Shared with the static boundary
 *  test so the source check and the runtime check cannot drift apart. */
export const CONTENT_SCRIPT_MESSAGES: ReadonlySet<string> = new Set([
  "WALLET_CONNECT",
  "X402_DETECTED",
  "OPEN_X402_CHECKOUT",
]);

const CONNECT_PROMPT_PATH = "/connect-prompt.html";

export interface MessageSender {
  id?: string;
  url?: string;
}

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Compared as scheme + host, NOT `URL.origin`: for non-special schemes such as
// chrome-extension: and moz-extension: the WHATWG origin is opaque ("null") in
// some runtimes, and "null" === "null" would match any two opaque URLs.
function sameExtension(url: URL | null, extensionBase: string): boolean {
  const base = parse(extensionBase);
  if (!url || !base || !base.host) return false;
  return url.protocol === base.protocol && url.host === base.host;
}

/** True when the sender is a page served from this extension.
 *  `extensionBase` is `browser.runtime.getURL("/")`, e.g.
 *  `chrome-extension://<id>/`. */
export function isExtensionPage(sender: MessageSender, extensionBase: string): boolean {
  return sameExtension(parse(sender.url), extensionBase);
}

/** Content scripts are registered only for HTTPS pages. Require that browser
 * supplied URL here too, rather than treating every non-extension sender as a
 * content script. A missing, malformed, opaque, or cleartext URL has no
 * authority to drive even the deliberately small content-script message set. */
function isHttpsContentScript(sender: MessageSender): boolean {
  const url = parse(sender.url);
  return url?.protocol === "https:" && url.hostname.length > 0;
}

/** Decide whether `type` may be handled for this sender. Fails closed: an
 *  unknown sender id, a missing or unparseable URL, or a non-string type is
 *  refused. */
export function messageAllowed(
  type: unknown,
  sender: MessageSender,
  runtimeId: string,
  extensionBase: string,
): boolean {
  if (sender.id !== runtimeId) return false;
  if (typeof type !== "string") return false;

  if (type === "WALLET_CONNECT_DECISION") {
    const url = parse(sender.url);
    return sameExtension(url, extensionBase) && url!.pathname === CONNECT_PROMPT_PATH;
  }
  if (isExtensionPage(sender, extensionBase)) return true;
  return isHttpsContentScript(sender) && CONTENT_SCRIPT_MESSAGES.has(type);
}
