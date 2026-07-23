import { defineConfig } from "wxt";

// FurlPay extension — MV3, cross-browser (Chrome/Edge/Firefox via WXT).
// Permissions are deliberately minimal (CWS rejection reason #1 is
// over-permissioning): no clipboard, no scripting, no webRequest.
// The manifest is a FUNCTION of the build mode because two of its fields must
// differ between a local checkout and a Chrome Web Store upload, and shipping
// the development values is a launch blocker either way:
//
//   `key`             — pins the extension id so the passkey RP can allow-list
//                       `chrome-extension://<id>`. Correct locally, WRONG in the
//                       store: CWS issues its own key for a listing, and an
//                       uploaded package carrying this one gets a different id
//                       than the RP expects, so every production passkey
//                       assertion fails on origin.
//   `host_permissions`— localhost:3000 is the backend dev server. In a published
//                       listing it is an unjustifiable permission over a host
//                       the user does not control, and over-permissioning is the
//                       single most common CWS rejection reason.
//
// Production builds (`wxt build`/`zip`, mode "production") therefore omit both.
// After the first upload, set FURLPAY_EXTENSION_ID (apps/web/.env.example) to
// the id CWS assigns, or production assertions will still fail on origin.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // The web backend dev server owns :3000 (extension host_permissions match it);
  // keep WXT's HMR server off that port.
  dev: { server: { port: 3001 } },
  manifest: ({ mode }) => {
    const isProduction = mode === "production";
    return {
    // DEVELOPMENT ONLY — see the header. Without a key Chrome derives the id
    // from the load PATH, so it differs per machine and per checkout directory,
    // which makes it useless as a server-side trust anchor. With this key the
    // id is always `aeinggnckhnkgpaikcejcgodbdggegjh` (first 16 bytes of
    // SHA-256(DER public key), nibbles mapped a-p). It is a PUBLIC key: it
    // fixes identity, it is not a secret, and it grants nothing on its own.
    ...(isProduction
      ? {}
      : {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA50DTaffvHTJ4FYxa34ksVwv56oZ6p4pnCdq4GERUDnU62Jg9LCKPj0D70Dg2MU2cgDizbTOa5LPV+MA2qoRpaZhEvTV0g6kPGPvrQhpWzieeBZB2VIOK547SZAVrRyjeoIzfsSsBvapnUcNEi89JiMFwHXp59lN8kXecO9LbmyFHTR9N2mjyJUNc4QjyAT06tft3CzXbmx5RF7IskrWACQINAqbV3MbJ+V3uDPGLeLQU8Q15X5csu/STT6NI96ZGzaLVXYfgpDcL1uDzP5LYCYMU6R031eCtHSAvxu3BjzD5TkJ0n1Is/gJ7/l062EiZBy/sgrXLzb3Fk9NL8wlXsQIDAQAB",
        }),
    name: "FurlPay — Pay, Book, Invest",
    short_name: "FurlPay",
    description:
      "x402 stablecoin payments, biometric card approvals, travel booking and fee savings — directly from your browser.",
    permissions: ["storage", "notifications", "sidePanel", "alarms", "activeTab"],
    host_permissions: [
      // Session-cookie API calls to the FurlPay backend only.
      "https://furlpay.com/*",
      "https://www.furlpay.com/*",
      // Backend dev server — never in a published listing.
      ...(isProduction ? [] : ["http://localhost:3000/*"]),
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
    };
  },
});
