# Production gap audit — FurlPay

**Date:** 30 September 2026
**Baseline:** `92e9c57` on `docs/architecture-2026-09-29` (plus an uncommitted durable-webhook change set that predates this audit and is not part of it — see §7).
**Method:** source tracing of every money, compliance and account-scoped route; a marker sweep (`TODO|FIXME|mock|demo|placeholder|stub|fake|hardcoded|simulat|…`) across `apps/web/src/app/api` and `native-app/app`; the existing CI gates run against the tree; the full web and native test suites before and after.

Evidence lines marked **@HEAD** are line numbers at `92e9c57` (`git show 92e9c57:<path>`), because the fix has since moved them.

---

## 0. What this audit concluded, in one paragraph

The fail-closed architecture the brief asks for **already exists** and is sound: per-capability money flags with an `unimplemented` reason that no env var can override (`apps/web/src/lib/flags.ts`), a client-flag registry that is explicitly never an authorisation (`lib/clientFlags/registry.ts`), a public production-status registry (`lib/productionStatus.ts`), a card-issuer port with a gate every `api/cards/**` route calls (`lib/cardIssuer.ts`), and fiat provider ports (`lib/providers/types.ts`). The defects found were **routes that bypassed that architecture**: they read the seeded demo account instead of the caller, or served fixtures as fact, or skipped the gate. Twelve such defects were fixed in code (§2). Everything that needs a regulated partner, an Apple account, a device, or real users is listed as blocked (§4), not simulated.

---

## 1. Root-cause classes

| Class | Mechanism | Found in |
|---|---|---|
| **A. Demo-account reads** | `import { db } from "@/lib/store"` — the seeded demo account, present in every production process (`store.ts` `seedDemoAccount()`), used where the caller's account was meant | copilot, analytics graph, receipt matching, compliance routing, jurisdiction resolver |
| **B. Fixture served as fact** | A hardcoded value returned with no gate, in production | credit, rewards, travel referrals, bills, payroll roster, copilot APYs + hotels, mobile PAN/CVV, mobile SIP |
| **C. Gate bypass** | A route in a gated family that did not call the gate | travel virtual card (skipped `cardIssuerOr503`) |
| **D. Ordering race** | State made visible before it was funded, with an `await` in the gap | P2P order creation |
| **E. State-machine hole** | A transition that should not exist | P2P seller-cancel inside the payment window; markPaid after expiry |
| **F. Platform config gaps** | Missing iOS association / entitlement / APNs mode | iOS passkeys, universal links, App Attest, push |

Class A is the most important: `db` is exported for "demo-surface routes" (`store.ts:477`), and any route that imports it computes from a stranger's data. §5 lists the remaining importers.

---

## 2. Findings fixed in this pass

Severity: **P0** = wrong money/compliance data shown to real users, or a path to lose funds · **P1** = misrepresentation or an exploitable hole with a narrower blast radius · **P2/P3** = hygiene.

### PGA-001 · P0 · AI copilot answered every user from the demo account
- **Current (was):** `POST /api/chat` → `runCopilot(clean)` with no account (`apps/web/src/app/api/chat/route.ts:33` @HEAD); every tool read `db` (`lib/copilot/index.ts:1` @HEAD). A real user asking "what's my balance?" got the demo user's net worth, spend, holdings, KYC state and pending transactions.
- **Also:** a hardcoded yield table "USDC 8.2% · FurlPay Earn · Aave v3" (`index.ts:128` @HEAD) with a deposit confirmation into a route that 503s; invented hotel listings via `generateStays` (`index.ts:395` @HEAD).
- **Expected:** answers from the authenticated caller; rates only from a real source; no invented listings.
- **Fix:** `/api/chat` calls `requireUser` and passes `auth.account`; every tool takes the account; Earn quotes `selectVault().netApy` when `earnIsLive()`, otherwise says it is unavailable and offers no confirmation; travel points to the live search. Synthetic-travel baseline shrunk 11 → 10.
- **Test:** `apps/web/src/lib/__tests__/productionFabricationGates.spec.ts` (PGA-001, 4 cases). **Status:** FIXED.

### PGA-002 · P0 · Analytics graph built from the demo account
- **Was:** `lib/services/transactionGraph.ts:62` @HEAD read `db.transactions`; `api/analytics/graph` had no `requireUser` and was classified `PUBLIC_INTENTIONAL` (`security/route-manifest.json:31` @HEAD).
- **Fix:** builder takes the caller's transactions; route requires a session; manifest → `AUTHENTICATED_USER`.
- **Test:** PGA-002 (2 cases). **Status:** FIXED.

### PGA-003 · P1 · Receipt matching: demo data, cross-tenant leak, no validation
- **Was:** matched against `db.transactions` (`receipts/match/route.ts:28` @HEAD); one process-global map of matches (`:45-46` @HEAD) — any signed-in user's GET listed every other user's matched receipts, including references; no Zod (AGENTS rule 1).
- **Fix:** `requireUser` on both methods; Zod with bounds; per-user map; caller's transactions.
- **Test:** PGA-003 (3 cases, including a cross-user leak probe). **Status:** FIXED. **Residual:** matches are process memory (PGA-R03).

### PGA-004 · P0 · Credit reported $1,200 of debt to every user
- **Was:** `const drawn = 1200; // demo outstanding balance` (`credit/route.ts:57` @HEAD), served in production. A user with no collateral saw "$1,200 drawn, $0 available, health 0".
- **Fix:** new money flag `CREDIT_LIVE` with an `unimplemented` reason; generic gate `lib/capabilityGate.ts`; 503 in production, `simulated: true` elsewhere.
- **Test:** PGA-004 + flag-cannot-be-enabled case. **Status:** FIXED (capability remains unavailable — BLOCKED_EXTERNAL: lender).

### PGA-005 · P0 · Rewards and referrals: fixed earnings for everyone
- **Was:** every user got referral code `ASHU2026`, "7 invited, 4 converted, $60 earned", 1,840 points and "completed" missions (`rewards/route.ts:25,35-36` @HEAD). `api/travel/referral` served one process-global counter ("$300 earned") unauthenticated; `api/travel/referral/track` was an **anonymous write** crediting $25 per call (`track/route.ts:15` @HEAD) — earnings mintable with a loop.
- **Fix:** money flag `REWARDS_LIVE` (`unimplemented`); all three routes gated; referral GET requires a session; track validated with Zod; web rewards page shows "not available" instead of spinning.
- **Test:** PGA-005. **Status:** FIXED (capability unavailable until a rewards ledger exists).

### PGA-006 · P1 · Bill pay recorded payments that never happened
- **Was:** `action: "pay"` zeroed the bill and recorded a **settled** "On-chain bill pay · USDC" transaction with no money moved (`bills/route.ts:38` @HEAD); body parsed with bare `req.json()` (`:18` @HEAD). Reachable in production only by the demo account (real accounts start with `bills: []`), hence P1.
- **Fix:** money flag `BILL_PAY_LIVE`; pay and autopay gated; Zod; simulated transactions labelled "no funds moved".
- **Test:** PGA-006. **Status:** FIXED.

### PGA-007 · P0 · Payroll could create real payments to placeholder addresses
- **Was:** a "saved demo roster" at `0x1111…1111`, `0x2222…2222`, `0x3333…3333` (`payroll/route.ts:36-38` @HEAD), served by an **unauthenticated** GET (`:41` @HEAD) and used by POST whenever `employees` was omitted (`:59` @HEAD) — producing real, signable USDC intents totalling $12,900 to addresses nobody controls.
- **Fix:** `employees` required; roster removed; GET requires a session and returns an empty, non-persisted roster.
- **Test:** PGA-007 (mutation-checked: making `employees` optional again fails the test). **Status:** FIXED.

### PGA-008 · P0 · Travel virtual card bypassed the card-issuer gate
- **Was:** `POST /api/travel/cards/create` had neither `requireUser` nor `cardIssuerOr503`; in production it returned `status: "active"`, `network: "Visa"`, "funded from USDC balance" (`create/route.ts:28,52` @HEAD).
- **Fix:** both added; manifest → `AUTHENTICATED_USER`.
- **Test:** PGA-008 (401 + 503). **Status:** FIXED.

### PGA-009 · P1 · Recurring investments promised executions nothing performs
- **Was:** the schedule route's comment claimed "a cron/worker executes each due schedule" (`investing/schedule/route.ts:13` @HEAD) — none exists (`api/cron` has no DCA job), and the store is process memory. The mobile SIP sheet placed **one** order and then said "SIP active — $X every month" (`native-app/app/(tabs)/invest.tsx:226` @HEAD); no schedule was created anywhere. The copilot offered to "activate the schedule".
- **Fix:** money flag `RECURRING_INVESTING_LIVE` (`unimplemented`): creation 503 in production; every response states `automaticExecution: false`; copilot offers no DCA confirmation when unavailable; mobile now says "First buy placed … repeats aren't available yet".
- **Test:** PGA-009 (4 cases). **Status:** FIXED; execution BLOCKED (needs durable schedules + executor, and `BROKERAGE_LIVE`).

### PGA-010 · P0 · Compliance decisions used the demo account's region
- **Was:** `routeInboundDeposit(token, db.user.region)` (`compliance/route.ts:31` @HEAD) and `kycRegion: db.user.region` (`jurisdiction/route.ts:23` @HEAD). The demo region is `"EEA"`, and KYC region outranks country — so `?country=US&token=USDT` from anyone resolved as `{regime: "EEA", source: "kyc"}` and US/IN users were told their USDT would be MiCA-swapped to EURC (observed, see test comment).
- **Fix:** deposit routing requires a session and uses the caller's region; the public jurisdiction resolver uses `optionalUser` (caller's KYC region only when signed in; a bad credential is rejected, not downgraded).
- **Test:** PGA-010 (3 cases, both mutation-checked). **Status:** FIXED.

### PGA-011 · P0 · P2P: unfunded order visible across an await
- **Was:** `createOrder` wrote the order, reserved ad inventory and locked escrow; the route debited the seller **afterwards** and, on failure, rolled back through `await import("@/lib/services/p2p")` (`p2p/orders/route.ts:69,82` @HEAD). For the length of that await a live order backed by nothing was releasable — a release in the gap credits the buyer from escrow nobody funded.
- **Fix:** `createOrder(…, { fundEscrow })` debits synchronously **before** any mutation; the route has no rollback path.
- **Test:** `apps/web/src/lib/__tests__/p2pEscrowInvariants.spec.ts` (mutation-checked). **Status:** FIXED within one process — see PGA-R01.

### PGA-012 · P1 · P2P: seller could cancel while the buyer was paying
- **Was:** `cancelOrder` blocked the seller only on `paid` (`p2p.ts:667` @HEAD). A seller could cancel a `pending_payment` order while the buyer's fiat was in flight and keep both legs. `markPaid` ignored `expiresAt` (`:624` @HEAD).
- **Fix:** seller may cancel an unpaid order only after `expiresAt`; buyer may not mark paid after it.
- **Test:** 4 payment-window cases (mutation-checked). **Status:** FIXED.

### PGA-013 · P1 · Mobile showed a device-constructed card number
- **Was:** after biometrics the card sheet rendered `4111 5522 8834 {last4}`, expiry `09 / 29`, CVV `284` (`native-app/app/(tabs)/cards.tsx:293,302` @HEAD) — never requested from the server, labelled only by a banner. (The web copy had already been fixed.)
- **Fix:** masked number + network only, with the reason full details are unavailable (no PCI vault exchange exists — `lib/cards/lifecycle.ts` `mintRevealGrant` TODO). No digits are constructed on the device.
- **Status:** FIXED.

### PGA-014 · P1 · iOS associations and entitlements
- **Was:** `associatedDomains` had `applinks:` only (`native-app/app.json:128` @HEAD) — no `webcredentials:` so iOS passkeys cannot work; no App Attest entitlement although `react-native-app-attest` ships; `expo-notifications` `mode` unset so `aps-environment` defaulted to `development` for every build (sandbox push tokens in a store build — 3DS2 approvals ride on push); and **no `apple-app-site-association` is served** (`apps/web/public/.well-known/` has only `assetlinks.json`).
- **Fix:** `webcredentials:furlpay.com` + `com.apple.developer.devicecheck.appattest-environment: production` in `app.json`; APNs mode follows the build env in `app.config.js`; new route `apps/web/src/app/.well-known/apple-app-site-association/route.ts` that **404s until `APPLE_TEAM_ID` is set** (never invents a Team ID) and mirrors Android's `/l/*`.
- **Tests:** `native-app/lib/__tests__/apnsMode.test.ts`, `apps/web/src/app/.well-known/apple-app-site-association/__tests__/aasa.spec.ts`. **Status:** CODE COMPLETE; BLOCKED_EXTERNAL (Apple Team ID, App ID capabilities).

### PGA-015 · P2 · Signer abstraction covered transactions only
- **Was:** `AccountSigner` had no message/typed-data methods; WalletConnect imported `signMessage`/`signTypedData` from `lib/wallet` directly (`lib/walletconnect/runtime.ts:1` @HEAD), so a hardware signer could never answer `personal_sign`.
- **Fix:** optional `signMessage`/`signTypedData` on the interface; `signMessageWith`/`signTypedDataWith` refuse (never fall back) when a signer lacks them; device-key signer delegates to the same functions; WalletConnect routes through `defaultSigner()`.
- **Test:** `native-app/lib/__tests__/signerMessageRouting.test.ts` — signatures are **byte-identical** to the old direct calls. **Status:** FIXED. See `docs/architecture/SIGNER_ARCHITECTURE.md`.

### PGA-016 · P3 · Localization had no per-key untranslated tracking
- **Was:** the only guard was "< 20% of strings identical to English" (`lib/i18n/__tests__/i18n.test.ts`), which never names a key; no plural-category check.
- **Fix:** `translationRatchet.test.ts` + `translation-baseline.json`: per-locale, per-key lists that may only shrink; CLDR plural categories checked via `Intl.PluralRules`. Report: `docs/i18n/LOCALIZATION_REPORT.md`.
- **Correction to the Sep 30 comparison:** Hindi is **not** incomplete — key parity is enforced by the compiler (`locales/types.ts`); the shorter file is formatting. Real gaps: es/fr/pt lack the CLDR `many` form in 7 plural sets (affects exact millions only). **Status:** FIXED (gate); translations BLOCKED on a human translator.

### PGA-017 · P3 · Native suite failed on every full run
- **Was:** `accountDrawer.test.tsx` exceeded Jest's 5 s default under full-suite load (passes alone, 10/10) — the suite has been red on full runs, including before this audit.
- **Fix:** per-file `jest.setTimeout(20_000)`; no assertion changed (same reasoning as `apps/web/vitest.config.ts`). **Status:** FIXED.

---

## 3. Found, not fixed — with reason

| ID | Sev | Finding | Evidence | Why not fixed here |
|---|---|---|---|---|
| PGA-R01 | **P0 (prod blocker)** | P2P state (ads, orders, escrow) is process memory. No cross-instance lock, no durability; a second serverless instance sees a different order book | `lib/services/p2p.ts` header ("MOCK/in-memory"), `state` map | Needs a Postgres schema with row-level locking / serializable transitions. P2P stays off in production (`p2pSettlementUnavailable`, `lib/services/p2pSettlement.ts`) |
| PGA-R02 | P1 | No operator path resolves an appeal — an appealed order's escrow is frozen forever | no `resolveAppeal` anywhere (`grep`) | Needs an ops console + dual control; product decision |
| PGA-R03 | P2 | Receipt matches, DCA schedules, payroll roster, travel referrals are process memory | the respective route files | Durable storage is part of making each capability live |
| PGA-R04 | P1 | 10 remaining production paths import synthetic travel generators, including a **money action** `api/actions/book-car` | `apps/web/scripts/synthetic-travel-baseline.json` | Each needs a real inventory provider or removal; tracked by the shrinking CI gate |
| PGA-R05 | **CLOSED in pass 2** (see §8) | Remaining `db` importers. **`lib/services/policyEngine.ts:46` — card-authorisation velocity uses `req.transactions ?? db.transactions`**; both production callers (`api/cards/spend:56`, `webhooks/card-auth:173`) pass the owner's history, but a future caller that omits it silently computes limits from the demo account. Same default in `reports.ts` and `spendingSummary.ts`. `webhooks/deposit-detect` credits the demo account's balances (**file is in the pre-existing uncommitted change set**). `auth/webauthn` mints a demo session without verification (404 when `NODE_ENV=production`). | `grep -rn 'import { .*\bdb\b' apps/web/src` | Making `transactions` required is the fix, but `decayingAllowance.spec.ts` calls `evaluateSpend` 11 times relying on the demo fallback — those tests need explicit fixtures first, a change worth doing on its own. deposit-detect is under active uncommitted work and was deliberately not touched |
| PGA-R06 | P3 | `earn/deposit` and `p2pSettlementUnavailable` gate on `NODE_ENV` instead of `financialEnvironment()` | `earn/deposit/route.ts:33`, `p2pSettlement.ts` | Direction is stricter (preview blocked), not a hole; convert when those capabilities are built |
| PGA-R07 | P3 | 18 routes validate bodies manually rather than with Zod (`BODY_MANUAL_VALIDATION`) | `node apps/web/scripts/check-route-security.mjs` | Existing, tracked warning list |
| PGA-R08 | P3 | `CRON_SECRET` is read in 7 places but not registered in `lib/env.ts` (AGENTS rule 10) | `grep -rho 'process.env.[A-Z_]*CRON' apps/web/src` | Rule-10 hygiene; no behaviour change |
| PGA-R09 | P3 | es/fr/pt missing CLDR `many` plural forms (7 sets each) | `docs/i18n/LOCALIZATION_REPORT.md` | Needs a translator |

---

## 4. Gaps that cannot be closed in code

| Gap | Status | Exact external dependency |
|---|---|---|
| Card issuing, physical cards, PAN reveal, wallet provisioning, ATM | BLOCKED_EXTERNAL | Issuer processor + BIN sponsor + network programme (Rain adapter exists: `lib/cards/rainAdapter.ts`), PCI vault exchange endpoint, Apple/Google push-provisioning entitlements |
| Banking, fiat deposit/withdrawal, payouts, beneficiaries | BLOCKED_EXTERNAL | Licensed banking / aggregator partner; ports exist (`BankingProviderAdapter`, `OnrampProviderAdapter`, `OfframpProviderAdapter`) |
| Credit | BLOCKED_EXTERNAL | Licensed lender, collateral custody model, liquidation engine |
| Bill pay | BLOCKED_EXTERNAL | Biller network / aggregator |
| Trading, recurring investing | BLOCKED_EXTERNAL | Live brokerage agreement (`BROKERAGE_LIVE`); plus durable scheduler (code) |
| Rewards / referrals | BLOCKED (code + policy) | Per-user rewards ledger, fraud controls, programme terms |
| P2P live | BLOCKED (code + legal) | Durable locked store (code), dispute operations, jurisdictional review of P2P fiat matching |
| Hardware wallets | NOT STARTED (by design) | Vendor SDK + devices for testing; the signer seam is ready (PGA-015) |
| Independent security audit | BLOCKED_EXTERNAL | External firm; see `docs/security/SECURITY_HARDENING_2026.md` |
| iOS release | BLOCKED_EXTERNAL | Apple Developer account, Team ID, App ID capabilities, macOS build host |
| Cold-start / frame metrics | BLOCKED (hardware) | Android device or emulator; see `docs/performance/PERFORMANCE_BASELINE.md` |
| Real-user validation | BLOCKED | A store listing and users |

---

## 5. Verification

| Check | Before | After |
|---|---|---|
| `apps/web` `vitest run` | 306 files passed, 1 failed to load (hook timeout), 5,650 tests | **310 files passed, 5,697 tests passed, 0 failed** (+ tests added after that run, re-run individually) |
| `native-app` `jest` | 1,779/1,780 (accountDrawer timeout) | 1,819/1,820 on the full run before PGA-017; PGA-017 fixes the remaining one |
| `apps/web` `tsc --noEmit` | pass | pass |
| `native-app` `tsc --noEmit` | pass | pass |
| `check-no-synthetic-travel.mjs` | 11 known | **10 known** |
| `check-route-security.mjs` | clean | clean |
| route manifest specs | pass | pass (5 routes reclassified to `AUTHENTICATED_USER`; `_counts` updated) |

Mutation checks (fix reverted → test must fail): PGA-004, PGA-007, PGA-010 (×2), PGA-011, PGA-012 — all failed as expected, and the fix was restored. One test (PGA-010 jurisdiction) was found **vacuous** by this check and rewritten.

## 6. Re-audit

The marker sweep was re-run over the changed routes: every remaining `simulated`/`demo` occurrence in them is either inside a `capabilityMode(...) === "simulated"` branch or a comment recording history.

## 7. Not in scope of this change set

The working tree already carried uncommitted changes when this audit began (durable webhooks: `withDurableWebhook.ts`, `card-auth`/`deposit-detect`/`stripe` webhook routes, migration `0022_webhook_events.sql`, and a **staged deletion of `kycStateMachine.ts`** that was committed two commits earlier in `61a46f7`). None of it was modified here. The staged deletion should be confirmed intentional before the next commit.

---

## 8. Second pass (same day) — adversarial re-audit

Trigger: the first pass fixed demo-account reads **by import**; the second traced **data flow** (default parameters, fallback expressions, dev-fallback accessors) and swept the classes the first pass surfaced.

**Correction to the first pass.** §3 said `decayingAllowance.spec.ts` relied on `policyEngine`'s demo fallback. It does not — it calls a different, four-argument `evaluateSpend` from the allowance module. Nothing blocked the fix; it is now done (PGA2-001).

### Fixed

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| PGA2-001 | P1 | Demo fallbacks by **default parameter**: `policyEngine` card-auth velocity (`req.transactions ?? db.transactions`), `reports.buildPnl/buildTaxCsv`, `spendingSummary.buildSpendingSummary`, `ledger.recordMovement(userId = DEMO_USER_ID)`, `account.getAccountBalanceUsd(= DEMO_USER_ID)`, `payments.executePayment(= DEMO_USER_ID)` | Every default removed; parameters required; `tsc` proves no caller relied on one | `noDemoAccountInProduction.spec.ts` |
| PGA2-002 | **P0** | `webhooks/deposit-detect` credited **every** matched deposit — including ones to the shared treasury — to the **demo account**, and emailed the demo address; no real user's deposit was ever attributed (file is in the pre-existing uncommitted change set) | Recipient = owner of a VERIFIED linked wallet; treasury deposits recorded + audited `deposit.unattributed`, credited to no one; demo never touched | `deposit-detect/__tests__/durableCredit.spec.ts` (+2 cases), `replayIdempotency.spec.ts` rebased on a real linked wallet |
| PGA2-003 | P1 | `auth/guest` copied the demo seed's roles `["user","compliance_officer","admin"]` into a credential-less session on preview deployments | Guest sessions carry `["user"]` only | `guest.spec.ts` (mutation-checked) |
| PGA2-004 | P1 | `api/account/spend` debited a **real** ledger balance under "Card top-up · Arbitrum One"-style labels while no rail delivered anything; no idempotency (retry = double debit) | `ACCOUNT_SPEND_LIVE` (`unimplemented`) → 503 in production; `withIdempotency`; simulated labels | `productionFabricationGates.spec.ts` |
| PGA2-005 | P1 | `api/travel/rewards/claim` returned a "settled" withdrawal with a **random 20-byte txHash** in production and never deducted the claim (repeatable) | Gated on `REWARDS_LIVE`; simulation returns `txHash: null` | same |
| PGA2-006 | P1 | P2P: only 3 of 23 handlers were gated. Ads, saved **bank/UPI payment methods**, quotes, appeals and ratings ran in production on process memory | `P2P_LIVE` (`unimplemented`); every handler starts with the gate; preview builds stay closed | `p2pGate.spec.ts` (static every-handler check + behavioural) |
| PGA2-007 | P2 | 52 env vars read by production code but unregistered (AGENTS rule 10), incl. `TURNKEY_API_PRIVATE_KEY`, `STRIPE_ISSUING_KEY`, `CRON_SECRET`, `COMPLYADVANTAGE_WEBHOOK_SECRET` | Registered in `lib/env.ts`, documented in `.env.example` | `envRegistry.spec.ts` (fails on any new unregistered read; also forbids secret-looking `NEXT_PUBLIC_*`) |
| PGA2-008 | P2 | `furlpay_missing_constraints()` (0017) asserted 2 guards and only saw constraints, not unique indexes | Migration **0023** asserts 11 guards (constraints OR unique indexes) incl. webhook-event, payment, ledger-reversal, ftx and control-plane uniqueness | `schemaAssertionsV2.spec.ts` — runs the REAL migration SQL in PGlite |

New CI gates: `noDemoAccountInProduction.spec.ts`, `envRegistry.spec.ts`, `p2pGate.spec.ts`, `copilotAuthority.spec.ts`.

### Verified, no defect

| Area | Finding |
|---|---|
| `account/fund`, `escrow`, Stripe webhook | use `getDevelopmentDemoAccount()`, which returns `undefined` under `NODE_ENV=production` (pinned by test) |
| x402 / MPP mock settlement | unreachable in production: `x402Enforcement.ts` makes signature enforcement mandatory in the production financial environment, forcing the live branch, which refuses without a settler |
| `payments` settle / refund | hard stop in production independent of `INTEGRATION_MODE` |
| Webhook secrets | card-auth (`endpointSecret` → null in prod), Stripe (503 without secret), Persona / Sumsub (empty secret rejected before HMAC), ComplyAdvantage (throws), GitHub (503), Resend (svix + timestamp) — all fail closed |
| Dividend / corporate-action settlement | settled-id dedupe + in-flight lock + DB uniques (0006/0008) |
| Money column types | all `numeric`/`bigint`; no float money columns in any migration |
| Attestation | not relied upon: the only consumer records a FAILED verdict; nothing grants on `passed` |
| MCP tools | per-tool OAuth scopes enforced in `api/mcp`; payment tools only prepare intents requiring passkey approval |
| Copilot | LLM cannot add/alter/redirect actions (hostile-model and prompt-injection tests) |

### Remaining (not fixable here, or deliberately deferred)

| ID | Sev | Item |
|---|---|---|
| PGA2-R01 | P2 | Deposit attribution scans in-memory accounts only; a deposit for an account not loaded on the receiving instance is ignored (never mis-credited). Needs a durable `linked_wallets` address index lookup |
| PGA2-R02 | P2 | Sumsub and ComplyAdvantage webhooks have no timestamp window (replay of a captured valid payload); KYC ordering guard limits impact |
| PGA2-R03 | P3 | `x402/facilitator/settle` body is structurally checked by `verify()` but not Zod-validated (rule 1) |
| PGA-R01/R02 | P0/P1 | P2P durability and appeal resolution — now fully gated off |
| — | BLOCKED | Attestation verification (Apple/Google credentials + real device tokens), production migration state (probe SQL in `docs/release/PRODUCTION_CAPABILITY_MATRIX.md`) |
