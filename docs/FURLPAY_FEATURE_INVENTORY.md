# FurlPay feature inventory — merchant payments, payroll, banking

State of branch `feat/sui-collection` (stacked on `feat/merchant-payments`) as of
2026-10-09. Nothing here is deployed to production and no migration is applied
to any hosted database. Design detail lives in `docs/merchant-payments.md`.

Status key: **Tested** = implemented with automated tests run on this branch ·
**Implemented** = code exists, not exercised end-to-end · **Partial** ·
**Blocked** = needs something code cannot supply · **Not built**.

## Payment rails and checkout

| Feature | Status | Evidence / notes |
|---|---|---|
| Native-USDC registry (Arc 5042, Base, Arbitrum, Polygon, Ethereum, Solana, Sui) | Tested | `lib/payments/merchant/registry.ts`; Arc and Sui parameters verified live; Optimism/Avalanche listed but not collected (no deposit policy) |
| Chain-specific address validation | Tested | EVM regex, Solana `PublicKey`, Sui `0x`+64 hex; enforced in API, verifier and SQL (0040, 0043) |
| Integer money | Tested | USDC micro-units as `bigint`/text; `financialTripwires.spec` forbids `/ 10 ** decimals` |
| Independent on-chain verification before credit | Tested | EVM: log + receipt re-read + canonical block + depth; Solana: finalized tx, token balances; Sui: GraphQL balance changes re-read by digest |
| Confirmation policy per chain | Tested | `lib/chains/depositConfirmation.ts` (Sui: 1 certified checkpoint) |
| Replay / duplicate protection | Tested | receipt PK `(chain, tx, log)`; cross-intent replay refused in SQL |
| Under/overpayment, expiry | Tested | statuses `underpaid` / `overpaid` / `expired`; excess held in `mp:hold:<intent>` |
| Wrong chain / wrong token | Tested | chainId / genesis hash / Sui chainIdentifier pinned; token contract or coin type matched exactly |
| RPC failover / WebSocket detection | Not built | polling cron (2 min) + checkout polling; single RPC per chain with env override |
| Payment links, invoices, QR terminal, hosted checkout `/p/[slug]` | Tested | dashboard + public checkout; delta QR for the remaining amount |
| Variable (payer-chosen) amounts | Not built | links are fixed-amount |
| Refunds | Blocked | collection addresses are controlled by a custody provider not integrated; operators can only record `refund_requested` |
| Receipts download | Partial | payment detail shows evidence; no PDF receipt |
| Reconciliation (intent ↔ receipts ↔ ledger ↔ chain) | Tested | cron every 10 min; alerts only, never edits money |
| Pricing tiers 95/75/50/35 bps | Tested | admin-assigned; stamped on each link |

## Samsung Wallet, Sui, passkeys, POS

| Feature | Status | Evidence / notes |
|---|---|---|
| Sui USDC collection | Tested | incl. opt-in live mainnet run (`SUI_LIVE=1`); spec's coin type was fake (no on-chain metadata) |
| Samsung Wallet-specific integration | Blocked | Samsung's USDC is custodial (Coinbase), launches "late October 2026"; no public payment/deep-link API. FurlPay accepts USDC on Solana and Sui, which any wallet on those chains can pay; no Samsung badge is shown |
| Passkeys (WebAuthn) | Existing | login and Fingerprint Pay (`lib/biometrics/biometricPay.ts`); not blockchain signing |
| Android KeyStore "biometric signer" module | Not built | duplicates passkey Fingerprint Pay with no server verification |
| NFC "SoftPOS" | Blocked | card acceptance needs certified kernels; a FurlPay-to-FurlPay HCE "tap to open checkout" is feasible but needs a native build and a physical device |
| Google/Samsung Wallet push provisioning | Blocked | requires a card issuer / TSP partnership |

## Payroll

| Feature | Status | Evidence / notes |
|---|---|---|
| Roster, CSV import, invites, self-service | Tested | 0042, 0044; invite token hashed; acceptance bound to the roster email |
| Wallet-proven payout addresses | Tested | EIP-191 by the payout address; screened; employer-immutable afterwards |
| Draft batches, fee quote, sanctions pre-screen | Tested | blocked when any recipient is flagged or unscreenable |
| Per-chain router domains (Arbitrum/Arc/Base/Polygon) | Tested | `FURLPAY_ROUTER_ADDRESS_<CHAIN>` |
| Durable signing, re-issue of expired requests | Tested | router-compatible signature checks (low-s, v 27/28) |
| Employer-executed `batchPay` + chain-verified recording | Tested | e2e on a local node (chainId 42161) against the real router: exact contractor amounts, exact fees, replay reverts |
| FurlPayRouter hardening | Tested (existing) | 31/31 contract tests: nonce namespacing, MAX_BATCH 100, zero amount, 24 h deadline; NOT audited, NOT deployed |
| Dual approval, roles | Not built | no organization/team model exists; every merchant is one account |
| Scheduled recurring payroll | Not built | |
| Gas estimation, treasury balance check | Partial | wallet estimates gas; no pre-check of the employer's USDC balance |
| Seat/batch fee billing | Partial | quotes stored; only the 35 bps per-line fee is collected on-chain |

## Banking, FX, tax, compliance

| Feature | Status | Evidence / notes |
|---|---|---|
| Virtual accounts (EUR vIBAN, USD ACH, GBP) | Blocked | no licensed BaaS partner; nothing is issued or displayed as active |
| Fiat off-ramp / FX quotes / bank payouts | Blocked | needs a payout partner and corridors |
| W-9 / W-8BEN records | Tested | sealed TIN/name/address (AES-256-GCM); "form on file", not payee e-signature |
| W-8BEN-E | Not built | |
| 1099-NEC threshold watch | Tested | $600 ≤2025, $2,000 2026, none guessed after |
| e-FIRA / e-FIRC | Blocked | issued by the Indian AD bank; FurlPay must not produce them |
| KYB/KYC, PEP, adverse media | Existing elsewhere / not wired here | settlement onboarding has KYB; payroll and merchant flows do not gate on it |
| Wallet sanctions screening | Tested | OFAC + Circle on every payout and payer; fail closed |

## Ledger, billing, APIs, operations

| Feature | Status | Evidence / notes |
|---|---|---|
| Balanced journals for merchant collections | Tested | `merchant_payment_receive` posts via `ledger_post`; trial balance checked |
| Payroll ledger postings | Not applicable | non-custodial: funds move wallet to wallet; FurlPay books no balance |
| Subscriptions, usage billing, invoices to merchants | Not built | |
| Treasury yield | Not built (deliberately) | needs custody, legal and customer consent |
| Merchant webhooks | Tested | HMAC t.body, SSRF-pinned, retries, redelivery, test events, rotation, UI |
| `/api/v1/payment-links` | Tested | live secret keys only for creation; pk keys refused |
| v1 APIs for payroll, payouts, FX | Not built | |
| Operator console | Tested | held payments, alerts, tiers, address registration with proof of control |
| Env pre-flight `npm run merchant:check-env` | Tested | live probes: key sizes, RPC chain ids, router bytecode/USDC/paused, Sui |

## Migrations (unapplied anywhere)

`0040` collection subledger · `0041` webhooks · `0042` payroll, pricing, review
notes, reconciliation · `0043` Sui · `0044` contractor self-service. Each is
tested on PGlite and Postgres 18 (`~/.furlpay-verify/pg-harness`). Note: an
untracked `0042_payroll_and_banking_workspace.sql` and `0043_…` from another
session exist in the shared main checkout and collide with these numbers.

## External blockers

1. Production Supabase: apply 0040–0044 (needs 0009 ledger).
2. Custody provider for collection addresses (and refunds/sweeps).
3. A security audit and deployment of FurlPayRouter on the chosen chain(s).
4. Secrets: `FURLPAY_PARTNER_WEBHOOK_KEY`, `FURLPAY_TAX_ENCRYPTION_KEY`, cron secret, RPC URLs.
5. BaaS / payout partner (vIBANs, off-ramps, FX); AD bank for e-FIRA.
6. Samsung partner access if a Samsung-specific integration is wanted.
7. An organization/team model before dual approval and roles.

## Test results (this branch, 2026-10-09)

- `vitest run` (apps/web): **7,599 passed, 2 failed, 55 skipped** (507 files).
  Both failures pre-date this work: `releaseBranchGate.spec` (2 tests, also
  failing on production) and `nativeParity.spec` (Expo not installed here).
- `tsc --noEmit` (TS 5.5.3): 0 errors. `eslint` on changed paths: 0 errors.
- Production build (`turbo run build --filter=@furlpay/web...`, clean tree at
  f3f6bd7d): 4/4 tasks, 467 pages.
- Contracts (`hardhat test`, router suites): 31 passing.
- Postgres 18 harnesses: 0042 11/11, 0043 6/6, seed 9/9, 0040 17/17, 0041 9/9.
- Payroll e2e on local node: 3/3. Sui live mainnet: 1/1 (opt-in).
- CI has not run: `ci.yml` triggers on `main`/`extension-redesign` pushes and PRs only.
