import { defineConfig } from "wxt";

// FurlPay extension — MV3, cross-browser (Chrome/Edge/Firefox via WXT).
// Permissions are deliberately minimal (CWS rejection reason #1 is
// over-permissioning): no clipboard, no scripting, no webRequest.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // The web backend dev server owns :3000 (extension host_permissions match it);
  // keep WXT's HMR server off that port.
  dev: { server: { port: 3001 } },
  manifest: {
    name: "FurlPay — Pay, Book, Invest",
    short_name: "FurlPay",
    description:
      "x402 stablecoin payments, biometric card approvals, travel booking and fee savings — directly from your browser.",
    permissions: ["storage", "notifications", "sidePanel", "alarms", "activeTab"],
    host_permissions: [
      // Session-cookie API calls to the FurlPay backend only.
      "https://furlpay.com/*",
      "https://www.furlpay.com/*",
      "http://localhost:3000/*",
    ],
    icons: { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" },
    action: {
      default_title: "FurlPay",
      default_icon: { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    // Restrict runtime.sendMessage from web pages to FurlPay origins only.
    // Without this key no page can message the extension at all, but declaring
    // it pins the allowed set explicitly if an external bridge ever ships.
    externally_connectable: {
      matches: ["https://furlpay.com/*", "https://www.furlpay.com/*"],
    },
  },
});
