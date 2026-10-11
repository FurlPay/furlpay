# Codebase cleanup and hardening audit — 11 October 2026

Branch `cleanup/hardening-oct11`, based on `integration/consolidated-oct11` @
`c3c26050`. This is the master record. Two companion files hold the long
lists: [`DEAD_CODE_INVENTORY.md`](DEAD_CODE_INVENTORY.md) and
[`ENVIRONMENT_VARIABLE_AUDIT.md`](ENVIRONMENT_VARIABLE_AUDIT.md). The release
decision is in [`docs/release/CLEANUP_RELEASE_READINESS.md`](../../release/CLEANUP_RELEASE_READINESS.md).

Security boundaries, duplicate implementations, dependencies, attribution and
test verification are sections of this file rather than separate documents,
because each is short and they cross-reference one another.

## Scope and limits

Analysed in depth: `apps/web` (source, routes, middleware, configuration,
dependencies, environment). Checked by running their tests: the six workspace
packages in the root test script, `packages/contracts`, the database tooling.
**Not analysed for dead code or duplicates:** `native-app`, `apps/android`,
`apps/extension`, `apps/desktop`, `guardian`, `ios`, the Go, Python and Rust
SDKs, `infra`, and the top-level `furlpay-*` directories. Claims below apply
to the analysed scope only.

## Findings

Status: FIXED (changed and verified), RECORDED (documented, no change),
BLOCKED (needs an external action or a decision).

### P0 — security and data isolation

| ID | Finding | Evidence | Change | Verification | Status |
|---|---|---|---|---|---|
| P0-1 | Preview deployments used the production database and Redis. | The Vercel preview scope holds `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`. Six modules built clients from the raw variables: `lib/supabase.ts`, `lib/kv.ts`, `lib/locks.ts`, `lib/settlement/onboardingStore.ts`, `lib/services/notifications.ts`, and `lib/research/storage.ts` (found in review after the first pass: it takes `env` as a parameter, which the first version of the test did not match). | `lib/dataPlane.ts`: a non-production Vercel deployment gets no durable credentials unless its scope sets `FURLPAY_DATA_PLANE=isolated`, and never a Supabase URL naming a production project. All six modules read through it. Boot logs why. | `dataPlane.spec.ts`, 16 tests, including one that fails if any other file reads the credentials by any property or bracket access. | FIXED in code (`77bfa851`). Remote scope unchanged: BLOCKED on you. |
| P0-2 | Any signed-in user could read every account's payments. | `GET /api/payments/history` had no guard of its own and called `listPayments(limit)`, which returned all records with payer address and metadata. | `listPayments` requires an owner; the route resolves the user. | `routeExposure.spec.ts`. | FIXED (`653c69be`) |
| P0-3 | Any API key with `payments:read` could read every account's payments. | `GET /api/v1/payments` called the same unscoped function. | Scoped to the key's owner. | `routeExposure.spec.ts`. | FIXED (`653c69be`) |
| P0-4 | The emailed "lock my account" link returned 401 to anyone not signed in. Reaching it then exposed a locking GET to mail scanners; it now confirms on GET and locks on POST (`7bcd0cc6`). | `GET /api/security/lock` is session-less by design (HMAC in the URL) but was not in the middleware's public prefixes. Production answered `{"error":"Unauthorized"}`. | Added to the public prefixes. The route keeps its HMAC check and rate limit. | `routeExposure.spec.ts` asserts it is reachable and its five sibling routes are not. | FIXED (`6a40c440`). Review requested: this widens exposure of one route on purpose. |

Exposure of P0-2 and P0-3 was bounded by the payment store being in-process
memory on each serverless instance, so a caller saw only payments created on
the instance that served the request. It was still a cross-account disclosure.

### P1 — attribution

| ID | Finding | Evidence | Change | Status |
|---|---|---|---|---|
| P1-1 | Tracked files carry no tool attribution. | `git grep` for the trailer, footer, no-reply address and product link across all 5,661 tracked files: 0 matches. | None needed. | RECORDED |
| P1-2 | Nothing stopped it returning. | No setting, rule or test. | `.claude/settings.json` turns the commit trailer and pull request footer off; `AGENTS.md` states the rule; `attribution.spec.ts` fails on a tracked file or a new commit carrying it. | FIXED (`9a507536`) |
| P1-3 | 51 pull request descriptions carried the footer. | GitHub API. | Footer lines removed from all 51 on 11 October. PR #78 quotes a third-party changelog and was left. | FIXED |
| P1-4 | 465 commits carry a `Co-Authored-By` trailer. | `git log --all --grep`: 465 on all refs, 459 reachable from this branch, dated 1 July to 5 September 2026; newest is `e452cb98`. | Not rewritten. See the proposal below. | BLOCKED on your decision |

Legitimate mentions that were deliberately kept: the Claude connector and MCP
documentation, the agent-skills and CLI READMEs, and the user-facing labels
"AI-generated summary. Not investment advice." and "Generated by AI from
FurlPay help articles", which disclose an AI-written answer to the person
reading it.

#### History rewrite proposal (not executed)

Removing the 465 trailers means rewriting commit messages with
`git filter-repo --message-callback` and force-pushing every branch.

- Every commit from 1 July onward gets a new SHA, on all 67 remote branches.
- The SHA production runs (`d3d7422e`) and every SHA recorded in release
  documents, the status registry and deployment history stop resolving.
- All 46 open pull requests have to be recreated or force-updated.
- Every local clone and all 26 worktrees must be re-cloned or hard-reset.
- Signed commits, if any, lose their signatures.

It is reversible only from a full mirror backup taken beforehand. The
alternative already in place is to leave history as it is and prevent new
occurrences (P1-2). Nothing here was run.

### P2 — dead code

| ID | Finding | Change | Status |
|---|---|---|---|
| P2-1 | 34 of 1,779 source files in `apps/web/src` are reachable from no route and no test. | 6 components removed (953 lines); 28 kept and classified. | FIXED for the 6 (`82990e4a`); the rest RECORDED in the inventory |
| P2-2 | 31 files are reachable only from tests. | None: tested libraries awaiting integration. | RECORDED |

### P3 — environment

| ID | Finding | Change | Status |
|---|---|---|---|
| P3-1 | 9 documented variables are read by nothing. | Removed from `.env.example`; `FURLPAY_WEBHOOK_SECRET` removed from the registry. | FIXED (`50f13f48`) |
| P3-2 | 58 variables the app reads had no documentation; 18 of them matter in production. | The 18 documented; 42 remain. | Partly FIXED |
| P3-3 | `ORIGIN_VERIFY_SECRET` was read but not registered. | Registered. | FIXED |
| P3-4 | Production sets no alert destination. | None possible from the repository. | BLOCKED |
| P3-5 | Four variables set on Vercel are read by nothing here. | None; storage integrations create them. | RECORDED |

### P4 — dependencies

Tool: `depcheck` on `apps/web`, each result then confirmed by searching for an
import. Commit `3bef57f4`.

| Package | Finding | Change |
|---|---|---|
| `@googlemaps/js-api-loader`, `@googlemaps/markerclusterer`, `supercluster`, `@types/supercluster` | No import anywhere in the repository. | Removed. |
| `@scure/base`, `tweetnacl`, `bs58` | Imported by production code (payout address validation, collection-address proof of control, Sui signatures) but declared in no manifest; resolved only because another package hoists them. | Declared at the locked versions. |
| `pdfjs-dist` | Imported by `receipt.spec.ts`; in no manifest and no lockfile. The test passed only where the package happened to be installed above the checkout, and would fail on a clean install. | Declared as a devDependency. |
| `@maplibre/maplibre-gl-style-spec` | Imported by a test; hoisted only. | Declared as a devDependency. |
| `@furlpay/account-kit` | Reported unused; referenced by `next.config.js`. | Kept. |

Not done: a version-conflict and deprecation review across all workspaces, and
any dependency audit of the native apps and SDKs.

### P5 — routes and duplicate implementations

**Manifest versus middleware.** The route manifest classifies a handler by the
guard it carries; the middleware decides whether an anonymous caller reaches
it. They disagreed for 28 routes, not three: classified `PUBLIC_INTENTIONAL`,
session-gated in practice. Two of the 28 were P0-2 and P0-4. The remaining 26
are now listed in `routeExposure.spec.ts`, each with the reason any signed-in
account may call it. The classification was not changed for those 26, because
it describes the handler correctly; the test makes the difference between
"no guard in the handler" and "reachable anonymously" explicit and reviewed.
No route was made public to make the two agree.

Two of the 26 deserve a product look, neither changed: `analytics/costs`
shows aggregate infrastructure cost to any signed-in user, and `earn/position`
is not scoped to an account (earn is not a live product).

**Duplicate implementations.** None was consolidated in this pass; each needs
callers migrated and is recorded for a decision.

| Area | Implementations | Canonical | Recommendation |
|---|---|---|---|
| Alert delivery | `lib/alerts` (Slack and generic webhook; 8 importers) and `lib/ops/alertSink.ts` (signed webhook; settlement safety, financial alerts, ops events). Different variables: `FURLPAY_ALERT_SLACK_WEBHOOK` / `FURLPAY_ALERT_WEBHOOK_URL` versus `FURLPAY_ALERT_WEBHOOK` + `_SECRET`. | Undecided | CONSOLIDATE. One incident can currently go to two places or neither. |
| JSON-RPC clients | 12 files issue raw JSON-RPC, among them `payments/merchant/rpc.ts`, `onchain/network-reader.ts`, `onchain/balances.ts`, `onchain/usdcIndex/rpcPool.ts`, and the unreachable `chains/evmAdapter.ts` and `chains/solanaAdapter.ts`. | `payments/merchant/rpc.ts` for money paths (bounded reads, chain identity check, failover) | CONSOLIDATE the unreachable `lib/chains` adapter layer first. |
| USDC blocklist read | `chains/arcCompliance.ts` (three-state result, fail closed) and an inline `eth_call` in `payments/merchant/verifier.ts`. | `arcCompliance.ts` shape | CONSOLIDATE into one helper used by both. |
| Batch payment creation | `/api/payments/batch`, `POST /api/payouts/payroll` (run a roster from the body), `/api/payouts/payroll/batches` (saved roster, screened, signed per line). | `/api/payouts/payroll/batches` for payroll | QUARANTINE the body-roster route pending a caller check. |
| Provider capability table | `lib/providers/capability.ts` (read by the router) and `lib/providers/providerMatrix.ts` (unreachable). | `capability.ts` | REMOVE `providerMatrix.ts` after one more review. |
| Telegram bot setup | `scripts/telegram-bot-setup.mjs` (`npm run telegram:setup`) and `apps/web/scripts/setup-telegram.mjs`. | The root script | CONSOLIDATE. |
| Readiness documents | `PRODUCTION_READINESS.md`, `docs/PRODUCTION_READINESS.md`, `docs/release/PRODUCTION_READINESS_FINAL.md`, `RELEASE_READINESS.md`, and others. | The dated files in `docs/release` | Mark the older ones superseded; not done. |

**The seven old-checkout implementations.** Re-examined. All seven remain
unported, for the reasons in `docs/release/CONSOLIDATION_2026-10-11.md`. They
exist only as uncommitted files in the primary checkout, which this work did
not touch. No travel-rule boundary, blocklist enforcement, payroll
authorization, destination screening or banking interface on the branch was
removed.

### P6 — observability

| ID | Finding | Change | Status |
|---|---|---|---|
| P6-1 | A key-value store that refuses commands silenced the health job. | Live read outside the job lock, alert `infra.kv_unavailable` (on the base branch, `50f54764`). | FIXED |
| P6-2 | With the store down the alert cannot be de-duplicated. | By design: counting is best-effort, so the alert repeats once per daily run rather than being lost. It cannot loop: the health job does not trigger itself. | RECORDED |
| P6-3 | No alert destination is configured in production. | — | BLOCKED |
| P6-4 | Nothing outside the deployment watches the scheduler. | The health route says so in its response. | BLOCKED |
| P6-5 | GitHub Actions cannot run. | — | BLOCKED (billing) |

## Security boundaries after this work

| Boundary | Enforced by | Test |
|---|---|---|
| Preview cannot reach the production database or Redis | `lib/dataPlane.ts` | `dataPlane.spec.ts` |
| Preview cannot run scheduled jobs | Vercel runs crons on the production deployment only; no cron secret is scoped to preview, and cron routes refuse without one | `cron.spec.ts`, observed 503 on the preview |
| Preview cannot verify provider webhooks or sign | No webhook or signing secret is scoped to preview; handlers fail closed without their secret | Existing webhook specs |
| Preview cannot send email or notifications | No email or push credential is scoped to preview | Observed scope |
| A payment listing shows only the caller's records | `listPayments(owner, …)` | `routeExposure.spec.ts` |
| A route needing a user is guarded in the handler when its path is public | — | `routeExposure.spec.ts` |
| Fail-closed rate limits, rail controls, job locks | Unchanged | `kvFailurePolicy.spec.ts` and others |

A caveat on the second, third and fourth rows: they hold because of what the
preview scope does **not** contain today. They are configuration facts, not
code guarantees. If production secrets are added to the preview scope, only
the first row still protects you.

## Review follow-up (second pass)

An external review of PR #114 raised four points. Each was acted on.

| Point | Action | Commit |
|---|---|---|
| A seventh credential reader, `lib/research/storage.ts`, bypassed the guard | Routed through `resolveDataPlane`; the bypass check now matches any property, bracket or destructured read | `ea8e4e9e`, `b26505d8` |
| A declaration of isolation is not proof of isolation | A preview whose Redis host is listed in `PROD_KV_HOSTS` is refused even when it declares isolation, alongside the existing production Supabase check; every hostile scope combination is tested | `b26505d8` |
| Only two payment routes were tested for cross-account access | Two-account suite through the real service and handlers: own records only by id and content, unauthenticated and under-scoped callers refused, query parameters naming the other account ignored, payment ids checked to be 96 random bits | `b26505d8` |
| A state-changing GET reachable without a session is fired by mail scanners | GET now only shows a confirmation page; the lock happens on POST from its button; no-store, no-referrer, noindex and a same-origin form CSP; tests for scanner GETs, replay, concurrency, account substitution, extended expiry, expired and tampered tokens, rate limit | `7bcd0cc6` |

Not adopted: making the lock token single-use. Locking is idempotent and only
narrows access, so a replay achieves nothing a first use did not, and a
consumed-token store would be one more dependency that can fail closed
against the person trying to secure their account.

Payment routes reviewed for ownership and found already scoped: ramp orders
(list and by id), the `/v1` control-plane payment routes (organization
tenancy), merchant refunds and receipts, payroll batches, settlement
transactions, payment create, execute and batch. `GET /api/payments/{id}` and
its receipt are deliberately readable by whoever holds the id (the payment link
holder is not the payer); that is safe only because ids are unguessable, which
the new suite checks.

## Test verification

Run on the final commit of this branch, in `apps/web` unless noted.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx next lint` | 0 errors, 1 warning (`HostedCheckout.tsx` hook dependencies, pre-existing) |
| `node scripts/check-claims.mjs` | no unqualified production claims |
| `node scripts/check-route-security.mjs` | 251 mutating routes, 0 FAIL, 0 WARN |
| `npx vitest run` | 538 files passed, 11 skipped; 8,040 tests passed, 55 skipped, 0 failed |
| `FURLPAY_DEV_AUTO_LOGIN=1 npx playwright test` (desktop and mobile) | 106 passed, 0 failed |
| `npm run build` (claims check, then `next build`) | compiled successfully; exit 0 |
| `npm audit --omit=dev` (root), with the CI allowlist logic | 9 high, 0 critical; all 9 are on the reviewed allowlist, so the CI gate would pass |
| `npx jest` (`native-app`) | 122 suites; 1,951 passed, 1 skipped, 0 failed |
| `cargo test --offline` (`sdks/rust`) | 3 passed, 0 failed |
| `go vet ./... && go build ./...` (`sdks/go`) | clean; the Go SDK has no test files |
| `python -m compileall` (`sdks/python`) | compiles; the Python SDK has no tests in the repository |
| `node scripts/gen-llms.mjs --check` | matches |
| `node scripts/aws/check-env-contract.mjs` (root) | OK, 24 variables |
| `node scripts/db/check-migrations.mjs --base origin/extension-redesign` (root) | 50 migrations, contiguous, none modified |

Run on the base commit `c3c26050` and not repeated, because nothing they cover
changed: workspace package suites (485 passed), Hardhat contracts (68 passing,
2 pending), database tooling tests (12 passed), the opt-in Sui mainnet read
(1 passed).

Baseline before this branch: 7,965 passed, 55 skipped. After: 8,040 passed, 55
skipped. The 75 additional tests are the six new specs.

**Not run:** Android (no JDK on the build machine), iOS and Wear OS builds;
Snyk (account quota exhausted); any test against a deployed environment or a
real network other than the read-only Sui check. The 55 skipped tests are
opt-in suites that need a database or a live network.

**GitHub Actions has not run on any commit of this branch.** Every job ends in
two to four seconds with the billing message. The results above are local runs
on one Windows machine. They are not a substitute for CI on the merge commit.

## Measured before and after

| | Before (`c3c26050`) | After |
|---|---:|---:|
| Tracked files | 5,661 | 5,664 |
| `apps/web/src` source files | 1,779 | 1,773 |
| Unreachable source files | 34 | 28 |
| Dependencies declared by `apps/web` that nothing imports | 4 | 0 |
| Packages imported by `apps/web` but undeclared | 5 | 0 |
| Documented variables read by nothing | 9 | 0 |
| Read-but-undocumented variables | 58 | 42 |
| Modules building a database or Redis client from raw variables | 6 | 0 |
| Routes public in the manifest, session-gated, unreviewed | 28 | 0 |
| Attribution matches in tracked files | 0 | 0 |
| Pull request descriptions with the footer | 51 | 0 |
| Commits with the trailer | 465 | 465 |
| Unit tests passing | 7,965 | 8,040 |
