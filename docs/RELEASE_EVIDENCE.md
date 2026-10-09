# Release evidence — merchant payments, payroll, Sui, refunds

Branch `feat/sui-collection` at `093e05c2` (stacked on `feat/merchant-payments`).
Everything below was executed locally on 2026-10-09. Nothing was deployed, no
hosted migration was applied, and CI has not run on these commits (`ci.yml`
triggers on pushes to `main`/`extension-redesign` and on pull requests only).

## Commands and results

| Check | Command | Result |
|---|---|---|
| Unit + integration (web) | `cd apps/web && npx vitest run` (TEMP outside %TEMP%) | **7,635 passed, 2 failed, 55 skipped** (514 files) |
| Type check | `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web` (TS 5.5.3) | 0 errors |
| Lint (changed paths) | `npx eslint <paths>` | 0 errors; 1 pre-existing warning (`HostedCheckout.tsx` hook deps) |
| Production build | `npx turbo run build --filter=@furlpay/web...` on a clean tree of `093e05c2` | 4/4 tasks, 467 pages |
| Contract tests | `npx hardhat test test/furlpay.test.ts test/routerNonceNamespace.test.ts` | 31 passing |
| Payroll end-to-end | local node chainId 42161 + real FurlPayRouter + MockUSDC; `PAYROLL_E2E_RPC=… npx vitest run payrollRouter.e2e` | 3/3 |
| Sui live (read-only, mainnet) | `SUI_LIVE=1 npx vitest run sui.live` | 1/1 |
| Postgres 18 harnesses (this session, latest migrations) | `~/.furlpay-verify/pg-harness/merchant-00{42,43,44,45,46}.mjs`, `merchant-seed.mjs` | 11/11, 6/6, 6/6, 6/6, 6/6, 9/9 |
| Postgres 18 harnesses (earlier, at `19c3726a`; 0040/0041 unchanged since) | `merchant-0040.mjs`, `merchant-0041.mjs` | 17/17, 9/9 |

## The two failing tests (not fixed)

- `releaseBranchGate.spec` (2 tests): the deploy gate was changed on purpose in
  `b0f56671` (audit P1-3: forced deploys need a written reason and may skip the
  release-branch restriction). The test still asserts the pre-change line, and
  the forced-deploy console warning no longer tells the operator that the branch
  restriction was skipped. A fix (restore that sentence in the warning; update
  the assertion to `if (!release.ok && !FORCED)`) was prepared but **blocked by
  the session's safety classifier as a CI change** and needs the owner's decision.
- `nativeParity.spec`: imports the Expo app's sources, which need the native
  app's dependencies installed; not investigated further in this session for the
  same reason.

Both fail identically on the production line; neither touches payment code.

## Financial invariants exercised

- Trial balance (sum of signed postings) is **zero after every refund step**
  (reserve, over-refund refusal, cancel/reversal, approve, complete, replay):
  `refunds-0045.spec.ts` (7 tests).
- Exact/under/over payments, receipt replay and cross-intent replay:
  `database.spec.ts`, harness 0040 (17/17).
- Concurrent payroll batch creation charges one seat fee per merchant-month and
  concurrent retries return the same batch: harness 0042 (11/11).
- Contractor receives exactly the line amount, treasury exactly the fee, replayed
  authorizations revert: payroll e2e (3/3).
