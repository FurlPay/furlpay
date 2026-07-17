# FurlPay — Chrome Web Store Review Instructions

Step-by-step guide for reviewers to exercise every surface of the extension.
No test account credentials are required for the majority of surfaces; where a
session is needed, a reviewer account is provided in the CWS private notes.

## 1. Install and first open

1. Load the extension and click the toolbar icon.
2. First open shows a three-step onboarding (Pay / Approve / Save).
   Click through or skip — it never shows again (`chrome.storage.local` flag).
3. Signed out, the popup shows a welcome screen with a "Sign in" button that
   opens `https://furlpay.com/login` in a new tab. The extension itself never
   collects credentials — authentication is the site's HttpOnly session
   cookie; the extension stores no tokens.

## 2. Signed-in surfaces (reviewer account in private notes)

1. Sign in at `furlpay.com/login`, then reopen the popup.
2. Wallet tab: net worth, portfolio chart, asset list, receive QR.
3. Activity tab: transaction history.
4. Approvals tab: pending 3-D Secure card challenges (if any). "Approve"
   deep-links to `furlpay.com` where the passkey (WebAuthn) ceremony runs on
   the site origin — by design the extension cannot approve by itself.
5. Earn tab: vault list and APYs.
6. Settings tab: session info, passkey list, notification explanation,
   sign-out.
7. Toolbar badge shows the account's net worth once signed in.

## 3. Content scripts (what runs where and why)

| Script | Match | Why |
|---|---|---|
| x402 detector | broad | Detects HTTP 402 payment-required responses — sites cannot be enumerated in advance because x402 is an open protocol any site may adopt |
| x402 overlay | broad | Renders the checkout sheet when (and only when) a 402 is detected |
| Fee scanner | `https?://*/*` | Compares card fees on checkout pages; exits immediately unless the URL/title looks like a checkout; never runs on browser-internal pages |
| Wallet announce | broad | EIP-6963 wallet discovery — any dapp may request wallet discovery |
| Wallet bridge | broad | postMessage relay for the above; no page data is read |
| Blink detector | broad | Adds a trust badge to FurlPay action links on social feeds; read-only DOM scan for FurlPay-owned URLs |

All injected UI renders inside closed shadow roots; no page styles or scripts
are touched. No content script reads form fields, passwords, or personal data.

To test the fee scanner: open any e-commerce checkout page (URL or title
containing "checkout"/"cart") with a visible dollar total — a small
comparison pill appears bottom-right; the X dismisses it for 7 days for that
site.

To test x402: open the DevTools panel "FurlPay x402" and visit a page that
returns HTTP 402 with a `PaymentRequirements` JSON body, or use
`https://furlpay.com/developers` sample endpoints.

## 4. Permissions justification

| Permission | Use |
|---|---|
| `storage` | Onboarding flag, dismissed-pill timestamps, notified-challenge ids, cached last-known overview (display only, no secrets) |
| `notifications` | New 3-D Secure challenge and deposit alerts |
| `sidePanel` | The travel-agent side panel |
| `alarms` | Balance/challenge polling (MV3 service worker wake) |
| `activeTab` | Opening the current tab's URL context for checkout hand-off |
| Host `furlpay.com` | The account API — the only host the extension calls |

The extension makes no requests to any host other than `furlpay.com` (and
`localhost` in development builds).
