# Production capability matrix

**Date:** 30 September 2026 (second-pass audit). **Baseline:** `92e9c57` + uncommitted changes.

Status vocabulary — nothing else is used:

| Status | Meaning |
|---|---|
| **LIVE_VERIFIED** | A production response was observed. Source: `apps/web/src/lib/productionStatus.ts` (observed 21 Sep 2026 against furlpay.com + `vercel env ls production`). Not re-observed in this pass — no production access. |
| **LIVE_BUT_UNVERIFIED** | Code path is real and not gated, but no production observation exists. |
| **FAIL_CLOSED** | Production answers 503 / refuses; a test proves it. |
| **SANDBOX_ONLY** | Runs only against a provider sandbox. |
| **MOCK_ONLY** | Runs only as a local simulation (dev/test); never reachable in production. |
| **BLOCKED** | Cannot be made live from this repository (partner, credential, account, device). |

A capability is FAIL_CLOSED in production **and** MOCK_ONLY in development at the same time; the table reports the production status and names the dev behaviour in the Environment column.

## Money and account capabilities

| Capability | Route / UI | Backend | Database | External provider | Security controls | Idempotency | Ledger impact | Observability | Mobile | Environment | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Stablecoin payment APIs (quote, 402 challenge, non-custodial calldata) | `api/x402/*`, `api/intents`, `api/payments/create` | `lib/x402.ts`, `lib/services/payments.ts` | `payments` (0009) | none (user's wallet signs) | requireUser, Zod, rate limit | `payments_idempotency_uniq` | none until signed | ops events | yes | prod | **LIVE_VERIFIED** |
| x402 challenge | `api/x402/fx` | `lib/x402.ts` | — | — | public, rate-limited | nonce claim | none | — | — | prod | **LIVE_VERIFIED** |
| x402 / MPP settlement | x402 middleware, `api/x402/facilitator/settle` | `lib/x402.ts`, `lib/x402Facilitator.ts`, `lib/mpp.ts` | — | Arbitrum RPC + facilitator signer | signature verification mandatory in production (`x402Enforcement.ts`), nonce `SET NX` | nonce claim | via settlement | `/api/rails` | — | prod: no settler → 402 `settler_unavailable`; dev: mock hash | **FAIL_CLOSED** (BLOCKED on signer + RPC) |
| Gasless USDC transfer | `api/transfers/gasless`, mobile send | `lib/wallet.ts` (EIP-3009) | — | relayer fee payer | EIP-3009 sig | nonce | none | `/api/rails` | yes | relayer not funded | **BLOCKED** |
| Payment execution (FurlPay-settled) | `api/payments/execute` | `settle()` in `lib/services/payments.ts` | `payments` | relayer | hard stop in production independent of `INTEGRATION_MODE` | status machine replay | posting via ledger | ledger | — | prod refuses | **FAIL_CLOSED** |
| Swaps (self-custodial) | mobile swap | `native-app/lib/swap/executeSwap.ts` + LI.FI | — | LI.FI, chain RPC | server-issued single-use quoteId; signer seam | quoteId | none (on-chain) | — | yes | not observed in prod | **LIVE_BUT_UNVERIFIED** |
| Swaps (server-settled) | `api/swaps` execute | `app/api/swaps/route.ts` | — | — | requireUser | — | demo ledger | — | — | prod 503 | **FAIL_CLOSED** |
| Account funding | `api/account/fund`, `api/webhooks/stripe` | `lib/services/account.ts`, `lib/ledger.ts` | ledger (0009) | Stripe / x402 settler | Stripe HMAC, fail-closed without secret | Stripe event + durable claim | credit via `recordMovement` | ledger, revenue excluded | — | depends on Stripe live keys (unverified) | **LIVE_BUT_UNVERIFIED** (Stripe) / **FAIL_CLOSED** (x402 fund without settler) |
| Spend from account balance | `api/account/spend` | `debitAccount` | ledger | none | requireUser, Zod, **ACCOUNT_SPEND_LIVE** gate | `withIdempotency` (added) | would debit | ledger | — | prod 503 | **FAIL_CLOSED** |
| On-chain deposit detection | `api/webhooks/deposit-detect` | route + `lib/services/deposits.ts` | `webhook_events` (0022), deposits | QuickNode / Alchemy | HMAC + timestamp, durable claim, ordering watermark, payload-mismatch refusal | `(chain, txHash)` durable + KV | credits the VERIFIED-linked-wallet owner only; treasury deposits unattributed | audit `deposit.unattributed` | — | webhook secret unverified | **LIVE_BUT_UNVERIFIED** |
| Cards (virtual, physical, reveal, provisioning) | `api/cards/**`, `api/travel/cards/create`, mobile Cards | `lib/cardIssuer.ts`, `lib/cards/*` | cards | card issuer (none) | `cardIssuerOr503` on every route | issue/reissue keys | none | security events | UI only | prod 503 | **FAIL_CLOSED** (BLOCKED on issuer) |
| Card authorisation (JIT) | `api/webhooks/card-auth` | `policyEngine.ts` (owner history now REQUIRED) | — | issuer | HMAC via `endpointSecret` (null in prod without secret) | durable claim | spend record | ops | — | no issuer | **BLOCKED** |
| Banking / fiat accounts, payouts | `api/banking`, `api/offramp*`, `api/onramp*` | `lib/providers/*` ports | ftx (0014) | bank / aggregator (none) | BANKING/ONRAMP/OFFRAMP_LIVE `unimplemented` | ftx uniques | — | — | UI preview | prod 503 | **FAIL_CLOSED** (BLOCKED on partner) |
| Credit line | `api/credit` | route | — | lender (none) | CREDIT_LIVE | — | — | — | UI | prod 503 | **FAIL_CLOSED** |
| Bill pay | `api/bills` | route | — | biller (none) | BILL_PAY_LIVE | — | — | — | UI | prod 503 | **FAIL_CLOSED** |
| Rewards / referrals / travel reward claims | `api/rewards`, `api/travel/referral*`, `api/travel/rewards/claim` | routes | — | rewards ledger (none) | REWARDS_LIVE | — | — | — | UI | prod 503 | **FAIL_CLOSED** |
| P2P marketplace (all 23 handlers) | `api/p2p/**` | `lib/services/p2p.ts` | none (process memory) | — | P2P_LIVE + NODE_ENV guard | release idempotency | would move escrow | — | UI (client flag off) | prod 503 | **FAIL_CLOSED** |
| Stock / ETF orders | `api/investing/order` | `lib/brokerage` | trade lots | Alpaca (keys dead per ops notes) | BROKERAGE_LIVE via `getBrokerage` | idempotency key | lot ledger | — | yes | prod 503 | **FAIL_CLOSED** (BLOCKED on brokerage) |
| Recurring investing | `api/investing/schedule`, mobile SIP | route | none | brokerage + scheduler | RECURRING_INVESTING_LIVE | key | — | — | one-off order only | prod 503 | **FAIL_CLOSED** |
| Dividends / corporate actions | `api/investing/*/settle` | `lib/corporateActions` | `dividend_events`, `reorg_events` (0006/0008) | brokerage data | settled-id dedupe + in-flight lock + DB unique | DB unique | `recordMovement` | `furlpay_missing_constraints()` | — | depends on 0006/0008 applied (UNVERIFIED) | **LIVE_BUT_UNVERIFIED** |
| Earn (Morpho) | `api/earn/*` | `lib/services/morpho.ts` | — | Morpho, Arbitrum RPC | prod refuses unless `earnIsLive()` | key | — | — | yes | `INTEGRATION_MODE` not live (unverified) | **FAIL_CLOSED** |
| Payroll | `api/payouts/payroll` | route | payments | none | requireUser, Zod, `employees` REQUIRED | payments idempotency | unsigned intents | — | — | prod | **LIVE_BUT_UNVERIFIED** (creates intents only) |
| AI co-pilot | `api/chat` | `lib/copilot` | — | Anthropic (phrasing only) | requireUser; caller's account only; deterministic actions; LLM cannot alter actions (tested) | — | none (HITL) | cost tracker | yes | prod | **LIVE_BUT_UNVERIFIED** |
| MCP connector | `api/mcp` | `lib/mcp/*` | — | — | OAuth 2.1 scopes per tool, passkey approval for payments | — | none | — | — | prod | **LIVE_BUT_UNVERIFIED** |
| Compliance routing / jurisdiction | `api/compliance*` | `@furlpay/compliance` | — | — | caller region only (fixed) | — | — | — | — | prod | **LIVE_BUT_UNVERIFIED** |
| KYC | `api/webhooks/persona`, `sumsub`, `complyadvantage` | `lib/kyc/*`, `lib/compliance/providers/*` | users | Persona / Sumsub / ComplyAdvantage | HMAC, empty secret refused; ordering guard | — | — | audit | yes | provider keys unverified | **LIVE_BUT_UNVERIFIED** |
| Passkeys (web) | `api/auth/passkey/*` | `@simplewebauthn/server` | users | — | verified ceremonies | — | — | — | — | prod | **LIVE_VERIFIED** |
| Passkeys (iOS) | app | — | — | Apple (AASA + Team ID) | AASA 404s until `APPLE_TEAM_ID` | — | — | — | code ready | — | **BLOCKED** |
| Device attestation (server) | `api/transactions/authorize` | `lib/integrity/providers.ts` | devices | Apple App Attest, Play Integrity | verification NOT implemented; verdict never `passed`; nothing grants on it | — | — | device record | client token only | — | **BLOCKED** |
| Market data | `/markets` | `lib/markets` | — | market-data providers | public | — | — | — | yes | prod | **LIVE_VERIFIED** |
| Hotel map | `/hotels/map` | `lib/hotels` | 0012/0015 (postgis) | OSM/places | public | — | — | — | yes | prod | **LIVE_VERIFIED** |
| Travel booking | `api/travel/*` | `lib/travel` | trips | Duffel (test credential refused in prod) | provider gate | — | — | — | yes | prod `source: unavailable` | **FAIL_CLOSED** |

## Provider state (Phase 11)

Evidence is `productionStatus.ts` (observed 21 Sep) and the flag registry; nothing was re-observed in this pass.

| Provider | Status | Basis |
|---|---|---|
| Supabase (prod `iyarllmcednkbekweucd`) | LIVE (migration set UNVERIFIED) | web/passkeys live; see §Operator probes |
| Upstash Redis / KV | LIVE (per ops notes) | distributed state cut over Jul 10; not re-observed |
| Stripe | UNKNOWN → must not act as LIVE | webhook refuses without `STRIPE_WEBHOOK_SECRET` in prod |
| Resend (email) | LIVE_BUT_UNVERIFIED | domain verification was blocked on DNS (ops notes) |
| Persona / Sumsub / ComplyAdvantage | UNKNOWN | webhooks refuse without secrets |
| Duffel / travel inventory | SANDBOX_ONLY | test credential, refused in production |
| Card issuer (Rain) | UNCONFIGURED | `CARD_ISSUING_LIVE` unimplemented |
| Banking / on-ramp / off-ramp | UNCONFIGURED | flags unimplemented |
| Alpaca brokerage | UNCONFIGURED | `BROKERAGE_LIVE` off; keys reported dead |
| LI.FI | LIVE_BUT_UNVERIFIED | quotes are real upstream calls |
| Circle CCTP / Iris | LIVE_BUT_UNVERIFIED | public API; production transfer not observed |
| Chain RPC | UNKNOWN | `ARBITRUM_RPC_URL` absent per productionStatus |
| Turnkey (MPC) | UNKNOWN | credentials now registered in `env.ts`; presence not observable here |
| Apple (AASA, App Attest, APNs) | UNCONFIGURED | no developer account |
| Google (Play Integrity, FCM) | FCM LIVE (ops notes); Play Integrity UNCONFIGURED | |

## Operator probes (cannot be run from this repository)

```sql
-- 1. Which uniqueness guards are missing in PRODUCTION? (needs 0017 + 0023 applied)
select * from furlpay_missing_constraints();   -- zero rows = all present

-- 2. Which migrations' objects exist? (the CLI history table may be empty if
--    migrations were applied through the Management API)
select 'webhook_events'        as obj, to_regclass('public.webhook_events')        is not null as present
union all select 'financial_transactions', to_regclass('public.financial_transactions') is not null
union all select 'cp_mandates',            to_regclass('public.cp_mandates')            is not null
union all select 'dividend_events',        to_regclass('public.dividend_events')        is not null
union all select 'reorg_events',           to_regclass('public.reorg_events')           is not null
union all select 'audit_log',              to_regclass('public.audit_log')              is not null;
```

```bash
# 3. Production env presence (names only, never values)
vercel env ls production | grep -E "FURLPAY_SESSION_SECRET|STRIPE_WEBHOOK_SECRET|DEPOSIT_WEBHOOK_SECRET|CRON_SECRET|APPLE_TEAM_ID|FURLPAY_ENV|INTEGRATION_MODE"
# 4. Preview deployments must NOT share the production session secret
vercel env ls preview | grep FURLPAY_SESSION_SECRET   # must exist AND differ from production
```
