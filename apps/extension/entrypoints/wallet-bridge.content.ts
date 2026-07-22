// Isolated-world bridge for the MAIN-world wallet provider. The MAIN world
// cannot call browser.runtime APIs, so connect requests are relayed here via
// postMessage and forwarded to the service worker, which resolves the user's
// Safe smart-account address from the furlpay.com session (cookie-auth; no
// tokens ever cross into the page world).

import type { BgResponse } from "@/lib/types";

const BRIDGE_REQUEST = "furlpay-wallet";
const BRIDGE_RESULT = "furlpay-wallet-result";

export default defineContentScript({
  // Bridges the MAIN-world provider on secure pages only. Must stay in step
  // with wallet-announce.content.ts: the provider is not announced over plain
  // http, so nothing here should be reachable there either. Narrowest scope
  // per CWS Limited Use (Aug 2026).
  matches: ["https://*/*"],
  runAt: "document_start",
  main() {
    window.addEventListener("message", (event) => {
      // Same-window messages only — never trust cross-frame senders.
      if (event.source !== window) return;
      const msg = event.data as { source?: string; id?: string; method?: string };
      if (msg?.source !== BRIDGE_REQUEST || typeof msg.id !== "string") return;
      if (msg.method !== "connect") return;

      void browser.runtime
        .sendMessage({ type: "WALLET_CONNECT" })
        .catch((e): BgResponse => ({ ok: false, error: String(e) }))
        .then((res: BgResponse<{ accounts: string[] }>) => {
          // Scoped to this document's origin, NOT "*": this payload carries the
          // user's Safe address, and a wildcard would hand it to any
          // cross-origin frame on the page listening for messages.
          window.postMessage(
            { source: BRIDGE_RESULT, id: msg.id, ...res },
            window.location.origin
          );
        });
    });
  },
});
