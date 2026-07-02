# Google Play listing copy — Furlpay

## App name (max 30 chars)
Furlpay

## Short description (max 80 chars)
Multi-currency payments and accounts, secured with passkeys. No passwords.

## Full description (max 4000 chars)
Furlpay is the on-chain financial operating system — stablecoin payments,
global multi-currency accounts, and fractional stock investing in one app.

• Multi-currency accounts — hold, convert, and spend across currencies from a
  single balance hub.
• Stablecoin payments — send and receive instantly on Base, Solana, Arbitrum
  and more, with zero gas.
• Passkey security — no passwords. Your fingerprint unlocks a private key that
  never leaves your device's secure enclave. Phishing-resistant by design.
• Compliance-aware — built to work with regulated rails.

Sign in with your fingerprint, Google, or phone number and manage your money
without borders.

Privacy policy: https://furlpay.com/legal/privacy
Terms of service: https://furlpay.com/legal/terms

## Console fields
- Package name: com.furlpay.app  (permanent — set at app creation)
- Category: Finance
- Privacy policy URL: https://furlpay.com/legal/privacy
- Contact email: ashutoshkumarsingh0x@gmail.com

## Assets in this folder
- feature-graphic.png — 1024×500 (required)
- screenshot-1-home.png, screenshot-2-login.png, screenshot-3-privacy.png —
  1080×1920 phone screenshots (min 2 required)
- ../store_icon.png — 512×512 app icon (required)

## Remaining Console forms (manual)
1. Financial features declaration (Play policy for finance apps — may require
   proof of licensing/registration per region).
2. Data safety form (declare collected data: email, phone, auth identifiers).
3. Content rating questionnaire.
4. Target audience (18+ recommended for finance).
5. After first upload with Play App Signing: copy the Play "App signing key
   certificate" SHA-256 from Release > Setup > App signing and ADD it to
   apps/web/public/.well-known/assetlinks.json (keep the existing upload-key
   fingerprint too), then redeploy the web app.
