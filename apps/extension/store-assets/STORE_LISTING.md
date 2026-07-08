# FurlPay Extension — Store Submission Kit

Everything needed to submit to the Chrome Web Store and Firefox Add-ons.
Specs verified against current CWS documentation (July 2026).

---

## Packages (built, in `.output/`)

| File | Target |
|---|---|
| `furlpayextension-1.0.0-chrome.zip` | Chrome Web Store upload |
| `furlpayextension-1.0.0-firefox.zip` | addons.mozilla.org upload |
| `furlpayextension-1.0.0-sources.zip` | AMO source-code upload (required because the build is bundled) |

Rebuild with `npm run zip` / `npx wxt zip -b firefox`.

## Listing copy

**Title** (max 45 chars, 28 used):
> FurlPay — Pay, Book, Invest

**Short description** (max 132 chars, 124 used):
> x402 stablecoin payments, biometric card approvals, travel booking & fee savings — from your browser. Passkeys, zero gas.

**Category:** Productivity → Tools (alt: Shopping)

**Full description:**

> FurlPay turns your browser into an on-chain financial terminal.
>
> ⬩ PAY — The first consumer x402 client: when a site answers HTTP 402 Payment
> Required, FurlPay shows a one-tap stablecoin checkout. Payments settle on
> Arbitrum in seconds, gas-free.
>
> ⬩ APPROVE — Card purchases that need 3-D Secure verification appear as
> native notifications. Review merchant, amount, location and a FurlPay
> Protect risk verdict, then approve with your fingerprint or Face ID —
> passkeys replace SMS codes, and they can't be phished.
>
> ⬩ TRACK — Your live balance sits on the toolbar icon. The popup shows your
> portfolio with real market charts, recent activity, cashback and rewards.
>
> ⬩ BOOK — An AI travel side panel searches hotels and flights you can pay
> for in USDC.
>
> ⬩ SAVE — On checkout pages, FurlPay shows what the merchant pays in card
> fees and what you'd save paying with FurlPay instead.
>
> ⬩ BUILD — A DevTools panel ("FurlPay x402") captures and decodes every
> x402 payment header on the page — the Postman of x402.
>
> SECURITY, BY DESIGN
> No seed phrases, no private keys, no tokens stored in the extension. Your
> session lives on furlpay.com; passkey signatures happen only on the domain
> they are bound to. Minimal permissions. All code bundled locally — no
> remote code, no eval.

## Assets

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | ✅ `public/icon128.png` |
| Small promo tile | 440×280 PNG/JPEG | ✅ `store-assets/promo-small-440x280.png` |
| Marquee tile (optional) | 1400×560 PNG/JPEG | ✅ `store-assets/promo-marquee-1400x560.png` |
| Screenshots | 1280×800 (or 640×400), 1–5 | ⬜ capture manually (below) |

**Screenshot plan (capture at 1280×800, dev profile signed in):**
1. Wallet tab — portfolio chart + quick actions + assets
2. Approve tab — approval card with FurlPay Protect verdict + countdown
3. x402 checkout overlay on a demo 402 page
4. Travel side panel with results
5. DevTools x402 inspector

Tip: open the popup, then `Ctrl+Shift+I` on it and use device toolbar to
compose against a 1280×800 canvas, or screenshot the popup and place it on a
branded background.

## Privacy & data disclosure (CWS questionnaire)

- Privacy policy URL: `https://furlpay.com/legal/privacy`
- **Does the extension collect user data?** Authentication information only:
  it sends the user's existing furlpay.com session cookie with API requests
  to furlpay.com (first party). No browsing history, no page content, no
  location, no keystrokes are collected or transmitted.
- Data is **not** sold, **not** used for unrelated purposes, **not** given
  to third parties → certify all three compliance statements.
- Aug 1 2026 rules: all data use is disclosed above; no prediction-market
  functionality; no AI-guardrail bypass.

## Permission justifications (paste into the form)

| Permission | Justification |
|---|---|
| `storage` | Cache UI preferences and the x402 detection log locally |
| `notifications` | Alert the user when a card payment awaits biometric approval |
| `sidePanel` | Hosts the travel booking assistant |
| `alarms` | Poll balance/pending approvals once per minute (MV3 workers are ephemeral) |
| `activeTab` | Read the checkout page the user invokes the fee scanner on |
| Host `furlpay.com` | First-party API calls with the user's session |
| Content script `<all_urls>` | x402 (HTTP 402) detection works on any site; the script only reads response status/headers of the page's own requests and injects the checkout overlay |

## Submission checklist

- [ ] CWS developer account ($5) under extensions@furlpay.com, 2FA + hardware key
- [ ] Upload chrome zip → fill listing (copy above) → attach tiles + screenshots
- [ ] Complete data disclosure + permission justifications (above)
- [ ] Distribution: all regions; visibility: public
- [ ] Submit; do NOT cancel/resubmit while pending (resets queue)
- [ ] AMO: upload firefox zip + sources zip, same copy
- [ ] After approval: test install on a clean profile; announce
