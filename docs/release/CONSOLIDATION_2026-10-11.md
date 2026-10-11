# Consolidation release record — 11 October 2026

Branch `integration/consolidated-oct11`, pull request #113 against
`extension-redesign`. This file records what the branch contains, what was
verified and how, what was deliberately left out, and what has to happen before
it is deployed. Statements about production are observations made on the date
above; re-check them before acting on them.

## Release decision: NO-GO until three external items clear

The code is merge-ready by every check that could be run locally. It is not
deployable today:

| # | Blocker | Owner | Evidence |
|---|---|---|---|
| 1 | GitHub Actions cannot run | Account owner | Every job ends in seconds with "recent account payments have failed or your spending limit needs to be increased". The deploy gate (`apps/web/scripts/check-deploy-gate.mjs`) requires a green CI run for the exact SHA. |
| 2 | Key-value store refuses commands | Account owner | Upstash for Redis store `upstash-kv-cinereous-sail`, Free plan, attached to production, preview and development. `GET /api/rails` and `GET /api/x402/fx` answer `503 controls_unavailable` (`plan_limit`); Telegram sign-in answers `503 temporarily_unavailable`. |
| 3 | Production migration state unknown | Operator with database access | The branch expects migrations `0001`–`0050`. Which of `0031`–`0050` are applied in production was not established. |

It becomes a CONDITIONAL GO when 1–3 are cleared. The conditions that remain
after that are functional, not release-blocking, and are listed under
"What will still not work after deploying".

## What the branch is

| Source | Commit | Brings |
|---|---|---|
| `feat/telegram-mini-app` | `d3d7422e` | What furlpay.com serves today; Telegram Mini App, migration `0050` |
| `feat/sui-collection` | `9ae66183` | Merchant checkout, Sui and Arc collection, payroll router, refunds, reconciliation, migrations `0040`–`0049` |
| `extension-redesign` | `6b93cc5d` | Docs accuracy rewrite |

Changes made on top of the merges:

- `route-manifest.json` is the union of both lines (436 routes), totals recomputed.
- `/api/transfers/sponsored` no longer tells callers a relayed transfer is "available today".
- `/api/cron/health` probes the key-value store with a live read outside the job lock and raises `infra.kv_unavailable`. Before this, a store that refused commands stopped the health job from running at all, so the outage in blocker 2 raised no alert.
- Docs: eight guides added and corrected against this tree; `scripts/gen-llms.mjs` and `docsIntegrity.spec.ts` keep the sidebar, search index, `llms.txt`, documented routes, migrations and cron entries consistent.

## Implementations deliberately not ported

Seven things existed only as uncommitted files in an older checkout. Each was
inspected. None was brought across.

| Item | Decision | Reason |
|---|---|---|
| `lib/compliance/travelRule.ts` (Notabene transport) | Not ported | No caller, no tests, no provider contract or credentials. Travel-rule messaging is a regulated exchange of personal data; an untested transport with nothing in front of it is not something to ship dormant. Status: not implemented. |
| `lib/onchain/circleBlacklist.ts`, `lib/compliance/usdcScreening.ts` | Not ported | They depend on four further uncommitted files (`onchain/rpc.ts`, `solana-usdc.ts`, `forensic-contract.ts`, and a `networks.ts` variant) that form a second on-chain reader beside the one this branch has. This branch already checks the USDC contract's blocklist where money is credited (merchant verifier) and for Arc (`lib/chains/arcCompliance.ts`). |
| `/api/payouts/batch` | Not ported | Overlaps `/api/payments/batch`, which exists here. Its one addition, screening recipients before creating intents, is already enforced at execution (`screenReviewAndSettle` in `lib/services/payments.ts`). |
| `/api/merchant/payroll`, payroll provider webhook | Not ported | A different payroll design on a different schema (`0042_payroll_and_banking_workspace`) from the committed one (`0042_payroll_and_merchant_extensions`). The two cannot share a database. |
| `/api/banking/virtual-accounts` | Not ported | Records requests for bank accounts. No banking partner is contracted and `BANKING_LIVE` is marked unimplemented; a request queue with nothing behind it invites the reading that accounts are offered. |

## Integration status

Statuses: production verified · implemented, unverified · implemented, disabled ·
blocked by external dependency · not implemented.

| Integration | Status | Tests | Blocker |
|---|---|---|---|
| Passkey sign-in, sessions | Production verified | Pass | — |
| Fee estimates, client-signed payment and CCTP construction | Production verified | Pass | — |
| Rail status, x402 challenges | Blocked by external dependency | Pass | Key-value store plan limit |
| x402 / MPP settlement, gasless relay | Implemented, disabled | Pass | No production signer, fee payer or relayer |
| Merchant checkout, invoices, QR | Implemented, unverified | Pass (unit, route, database) | Migrations `0040`–`0047`; collection addresses from a custody provider |
| Sui collection | Implemented, unverified | Pass; the opt-in spec against Sui mainnet GraphQL (`SUI_LIVE=1`, read-only) also passes | `SUI_GRAPHQL_URL`; as above |
| Arc collection | Implemented, unverified (mainnet); testnet only outside production | Pass | As above |
| Merchant refunds | Blocked by external dependency | Pass | A custody provider must send the transfer |
| Merchant reconciliation and alerts | Implemented, unverified | Pass | Migrations `0042`, `0046`; scheduled job |
| Merchant webhooks | Implemented, unverified | Pass | `FURLPAY_PARTNER_WEBHOOK_KEY`, migration `0041` |
| Contractor payroll | Blocked by external dependency | Pass | `FurlPayRouter` not deployed; contract unaudited |
| Settlement workspace, business onboarding | Implemented, unverified | Pass, including end-to-end | Migrations `0037`–`0039`; identity provider |
| Compliance cases, monitoring, reports | Implemented, unverified | Pass, including end-to-end | A granted compliance officer |
| Circle Compliance Engine | Implemented, disabled | Pass | `CIRCLE_COMPLIANCE_API_KEY` not set in production |
| Circle user-controlled wallets | Implemented, disabled | Pass | `CIRCLE_W3S_API_KEY`, `CIRCLE_W3S_APP_ID` not set in production |
| Coinbase hosted on-ramp / off-ramp | Implemented, disabled | Pass | No CDP key in production; contract status "in discussion" |
| Transak | Implemented, disabled | Pass | No contract; webhook not linked to orders |
| Echo Money | Not implemented as a usable adapter | — | API and webhook scheme unverified; never registered |
| Telegram Mini App | Blocked by external dependency | Pass | Key-value store plan limit; then migration `0050` |
| Travel-rule messaging | Not implemented | — | No provider |
| Card issuing, bank accounts, credit, bill pay, rewards | Not implemented | — | No partner; flags cannot be enabled |

## Verification

Run on this branch. Web commands run in `apps/web`.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx next lint` | 0 errors, 1 warning (`HostedCheckout.tsx` hook dependencies) |
| `node scripts/check-claims.mjs` | no unqualified production claims |
| `npx vitest run` | 533 files passed, 11 skipped; 7,965 tests passed, 55 skipped, 0 failed |
| `SUI_LIVE=1 npx vitest run sui.live` | 1 passed (read-only, Sui mainnet GraphQL) |
| `node scripts/db/check-migrations.mjs --base origin/extension-redesign` | 50 migrations, contiguous, none modified |
| `node --test scripts/db/*.test.mjs` | 12 passed |
| Workspace packages (SDK, compliance, security, ledger, gateway, control-plane) | 485 passed |
| `npm test --workspace @furlpay/contracts` | 68 passing, 2 pending |
| `npx playwright test --project=desktop` | 53 passed; three `@auth` specs require `FURLPAY_DEV_AUTO_LOGIN=1` |
| Vercel preview build | Ready |

Not run: Playwright `mobile` project; Expo, Android and iOS tests; Go, Python
and Rust SDK tests; any signed-in flow against a deployed environment; any
payment against a real network.

## Vercel configuration, as observed

| Setting | Value | Note |
|---|---|---|
| Project | `web`, root `apps/web`, Next.js, Node 24 | |
| Production branch | `main` | More than 600 commits behind. Merging #113 into `extension-redesign` does **not** deploy production. |
| Production deployment | `feat/telegram-mini-app` @ `d3d7422e`, a manual redeploy | |
| Scheduled jobs in production | 7 | This branch declares 9; `merchant-payments` (every 2 minutes) and `merchant-reconcile` (every 10) are new. |
| Team plan | Pro | Sub-daily cron schedules are permitted. |
| Alert sinks | Neither `FURLPAY_ALERT_SLACK_WEBHOOK` nor `FURLPAY_ALERT_WEBHOOK_URL` is set in production | Alerts are recorded when the store works and delivered nowhere. |
| Not set in production | `FURLPAY_ENV`, `FURLPAY_ADMIN_EMAIL`, `FURLPAY_PARTNER_WEBHOOK_KEY`, `FURLPAY_ROUTER_ADDRESS_*`, `SUI_GRAPHQL_URL`, `CIRCLE_*`, `FURLPAY_TAX_ENCRYPTION_KEY` | Each disables the feature that needs it; none is required for the app to boot. |

## Deployment sequence

Do not start until blockers 1–3 are cleared.

1. Establish the production schema: `DATABASE_URL=<read-only connection> node scripts/db/probe-schema.mjs`. It runs SELECTs only.
2. Apply any missing migrations in numeric order, on staging first. Every migration from `0031` on is additive; none drops or rewrites an existing column.
3. Confirm CI is green on the head of #113, then merge #113 into `extension-redesign`.
4. From a clean checkout of `extension-redesign`: `npm run deploy:prod`. The gate checks a clean tree, a pushed HEAD, the release branch and CI for that SHA.
5. `npm run smoke:prod`.
6. Re-probe: `/api/rails`, `/api/x402/fx`, `/p/<slug>` (must not redirect to sign-in), `/api/checkout/merchant/<slug>` (JSON, not the site 404), Telegram sign-in.
7. Update the dated evidence in `apps/web/src/lib/productionStatus.ts` from what step 6 returned.

## Rollback

The previous production deployment stays available on Vercel:
`dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk` (`d3d7422e`). Promote it back with
`vercel rollback` or from the dashboard. Migrations are additive, so the older
code runs against the newer schema; do not roll the database back.

## What will still not work after deploying

- Merchant checkout will show a link but cannot reserve a payment: no collection addresses exist until a custody provider is integrated and registers them with proof of control.
- Refunds cannot leave the approved state for the same reason.
- Payroll cannot issue a signable run in production: no router is deployed.
- x402 settlement and gasless transfers stay off: no signer or relayer.
- On-ramp and off-ramp stay off: no provider contract is live.

## Open security and compliance items

- `FurlPayRouter` and the other contracts in `packages/contracts` have not been independently audited.
- Three handlers (`/api/transfers/sponsored`, `/api/compliance/travel-rule`, `/api/payouts/validate-destination`) are classified `PUBLIC_INTENTIONAL` in the route manifest because they carry no auth check of their own, but the middleware requires a session for all three. Behaviour is the stricter of the two. The classification describes the handler, not the exposure.
- The bundled sanctions list is a snapshot as current as the last release.
- No external uptime check watches the scheduler; `/api/cron/health` says so in its response.
- Production, preview and development share one key-value store, so preview traffic spends the production quota.
