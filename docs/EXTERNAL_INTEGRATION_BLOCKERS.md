# External integration blockers

What code alone cannot supply, checked 2026-10-09. Each item lists what is
built, what is missing, and who must provide it.

| Area | Built | Missing (owner) | Source |
|---|---|---|---|
| Hosted database | Migrations 0040–0046, tested on PGlite and Postgres 18 | Applying them to staging, then production (FurlPay ops, needs approval) | `docs/DEPLOYMENT_RUNBOOK.md` |
| Collection addresses | Registration with proof of control; pilot seeding for non-production | Addresses controlled by a custody provider (Circle Wallets, Fireblocks, BitGo…) and a signed contract | — |
| Refund execution | Reserve, approve, on-chain-verified completion (EVM, Sui) | The custody provider sends the transfer; Solana completion not built | — |
| FurlPayRouter | 31 contract tests; per-chain domains; e2e on a local node | Independent security audit; deployment per chosen chain; owner/treasury keys | `docs/ARC-SECURITY-REVIEW.md` |
| Sui collection | GraphQL verifier, failover, live mainnet check | A paid GraphQL provider for volume (public endpoint is rate limited) | https://docs.sui.io/develop/accessing-data/json-rpc-migration |
| Samsung Wallet | Nothing Samsung-specific (deliberately) | Samsung's USDC feature is custodial (Coinbase Prime, Bastion), US-only, rolling out late October 2026; no public payment or deep-link API. Payers can still send USDC on Solana or Sui to a FurlPay checkout like from any wallet | https://www.coindesk.com/tech/2026/10/08/solana-partners-with-samsung-to-integrate-usdc-in-82-million-phones |
| Wallet pass / card provisioning | Not built | Card issuer + token service provider partnership; Samsung Wallet partner onboarding for passes | — |
| NFC card acceptance | Not built | A PCI MPoC/CPoC-certified SoftPOS provider; FurlPay must not build a card kernel | https://www.pcisecuritystandards.org |
| NFC FurlPay-to-FurlPay handoff | Not built | Feasible with Android HCE (NDEF URL); needs a native build and two physical devices to verify | https://developer.android.com/develop/connectivity/nfc/hce |
| Virtual accounts, fiat off-ramps, FX | Not built | Licensed BaaS / payout partner and corridors | — |
| e-FIRA / e-FIRC | Not built (must not be) | Issued by the Indian AD Category-I bank | — |
| W-9 e-signature | "Form on file" records with sealed TINs | Payee-facing e-signature flow meeting IRS requirements | Instructions for the Requester of Form W-9 |
| Webhook secret key, tax key | Code and checks | `FURLPAY_PARTNER_WEBHOOK_KEY`, `FURLPAY_TAX_ENCRYPTION_KEY` in each environment | `npm run merchant:check-env` |
| Team roles, dual approval | Not built | An organization/team model (engineering, not external) | — |
| CI | Workflows exist | A PR (CI runs only on PRs and main/extension-redesign); GitHub Actions billing must be unlocked | `.github/workflows/ci.yml` |
