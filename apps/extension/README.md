# FurlPay Browser Extension

MV3 extension (Chrome / Edge / Firefox via [WXT](https://wxt.dev) + React + TypeScript).

## Features

| Surface | What it does |
| --- | --- |
| **Popup** | Wallet (net worth + recent transactions), 3DS2 approvals inbox, Earn (rewards, missions, tier progress), Settings (backend URL, session, x402 activity) |
| **Toolbar badge** | Live USDC balance, refreshed every minute by the service worker |
| **Notifications** | New 3DS2 card challenges raise a native notification with Approve / Decline buttons |
| **x402 detector** (content script, MAIN world) | Patches `fetch`/XHR to catch HTTP 402 responses and slides up a checkout bottom-sheet |
| **Fee scanner** (content script) | On checkout pages, shows the card-fee vs FurlPay-fee comparison pill (7-day per-site dismissal) |
| **Side panel** | AI travel agent — free-text hotel search against `/api/travel/search`, book on furlpay.com |
| **DevTools panel** | "FurlPay x402" — live inspector for 402 responses with decoded PaymentRequirements |

## Security model

- **No tokens in extension storage.** Auth is the furlpay.com session cookie (HttpOnly), sent
  automatically thanks to host permissions. Nothing to exfiltrate from `chrome.storage`.
- **Biometric approval happens on furlpay.com**, never in the extension: WebAuthn credentials are
  bound to the `furlpay.com` rpID and cannot be asserted from a `chrome-extension://` origin.
  The extension only deep-links to `/cards/approve` — this is what makes the flow phishing-proof.
- Declining a transaction (safe direction) is allowed in-extension via the session-authed API.
- Content scripts are observe-only, render in **closed shadow roots**, and never read page forms.
- Minimal permissions: `storage`, `notifications`, `sidePanel`, `alarms`, `activeTab`.
  Host permissions limited to `furlpay.com` + `localhost` (dev). No `scripting`, no `webRequest`,
  no clipboard.
- Message handlers validate `sender.id === browser.runtime.id`.

## Develop

```bash
npm install               # from repo root (workspace)
cd apps/extension
npm run dev               # live-reload Chrome build
npm run dev:firefox
```

Point the extension at a local backend from **Settings → Backend URL** (`http://localhost:3000`).

## Build & ship

```bash
npm run build             # .output/chrome-mv3 (Load unpacked)
npm run zip               # .output/furlpayextension-<version>-chrome.zip for the Web Store
npm run build:firefox     # Firefox MV3 build
```

Store submission checklist lives in `docs/` (publishing playbook): privacy policy at
furlpay.com/privacy, data-disclosure questionnaire, 1280×800 screenshots, promo tiles.
