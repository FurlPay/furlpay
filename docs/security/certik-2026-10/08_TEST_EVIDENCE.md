# 08 — Test evidence

All runs on Windows 11, Node from the repository toolchain, branch
`security/certik-remediation-oct11` (base `0dce509b`). GitHub Actions is
billing-locked, so no CI run exists for these commits; every result below is
a local run. Nothing here was run against production.

## Commands and results

| Check | Command (from) | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p tsconfig.json` (apps/web) | exit 0 |
| Lint | `npx next lint` (apps/web) | 0 errors; 2 pre-existing `react-hooks/exhaustive-deps` warnings |
| Unit + integration | `npx vitest run` (apps/web, `TEMP` outside %TEMP%) | 545 files passed, 11 skipped; **8 089 passed, 0 failed**, 55 skipped (base `0dce509b`: 8 052 passed) |
| Contracts | `npx hardhat test` (packages/contracts) | **72 passing**, 2 pending, 0 failing |
| AP2 package | `npx tsc -p tsconfig.json && node --test dist/index.test.js` (packages/furlpay-ap2) | **18 passed**, 0 failed |
| Security package | `npm test` (packages/security) | **8 passed**, 0 failed |
| E2E | `FURLPAY_DEV_AUTO_LOGIN=1 npx playwright test` (apps/web, desktop + mobile) | see the E2E section |

## Regression tests added per finding

| Finding | Test file | What it proves |
|---|---|---|
| F-13 | `apps/web/src/app/api/agents/ap2/__tests__/ap2Replay.spec.ts` | One mandate across fresh route instances sharing one store: first 200, replay 402 `replayed`; 12 concurrent presentations over 4 instances → exactly one authorization; a new cart under a consumed single-use intent is refused; keys are hashed and namespaced; KV down → 503; over-long validity refused before any claim; bad bodies rejected before any claim. |
| F-13 | `packages/furlpay-ap2/src/index.test.ts` | Shared-store claims across two "instances"; the legacy per-instance `has/add` store accepting the replay (the vulnerable shape, kept as documentation); refused carts consume nothing; claim retention equals mandate expiry. |
| F-14 | `packages/furlpay-ap2/src/index.test.ts` | 0.1 + 0.2 lines equal a 0.3 total exactly; a total one atomic unit over the cap is refused; a total half a cent above its lines is refused (the old code accepted it); sub-6dp, negative, NaN, infinite, out-of-range, zero totals and negative offsetting lines are refused. |
| F-10 / F-38 | `apps/web/src/lib/__tests__/apiBodyCap.spec.ts` | No route code calls `req.json/text/arrayBuffer/formData()`; a 5 MB chunked body with no Content-Length is abandoned within the cap plus two chunks, for both `readJsonBody` and `validateBody`; a lying Content-Length does not raise the cap; `req.json()` error semantics are kept. |
| F-6 | `packages/contracts/test/compliance.test.ts` | Exactly 16 checks accepted, the 17th reverts `TooManyChecks`; a full 16-check evaluation estimates under 1 000 000 gas; duplicates revert; removal frees a slot; only the owner adds. |
| F-7 | `apps/web/src/lib/__tests__/sessionSecretHosted.spec.ts` | Signing with no secret works on a developer machine and throws under each of `VERCEL_ENV`, `AWS_LAMBDA_FUNCTION_NAME`, `AWS_EXECUTION_ENV`, `ECS_CONTAINER_METADATA_URI_V4`. |
| F-8 | `apps/web/src/lib/__tests__/deviceSignalsSchema.spec.ts` | Real collector output passes; deep nesting, oversized strings, long arrays, too many keys, non-identifier keys (incl. `__proto__`) and non-finite numbers are refused; `TransferSchema` uses it. |
| F-21 | `packages/security/test/security.test.js` | Both mock signing functions throw with `NODE_ENV=production`. |
| F-32 | `apps/web/src/lib/__tests__/x402XsgdRate.spec.ts` | No default rate; out-of-band and non-numeric rates refused; USDC-only advertisement without a rate; configured rate used when set. |
| F-42 | `apps/web/src/lib/__tests__/redactLabelledKey.spec.ts` | Six labelled forms redacted; bare tx hash, hash-labelled hash, 40-hex address and 130-hex signature kept. |

## E2E

Full run at `190c3e79` (all code changes in this pass), desktop and mobile:
**104 passed, 2 failed** in 52 minutes. Both failures were in
`support-auth.spec.ts` ("signed out, the ticket list") and both were the
machine suspending mid-run: `net::ERR_NETWORK_IO_SUSPENDED` on navigation and
a 180-second browser-launch timeout. Rerunning that spec: **24 passed, 0
failed**, including both tests. Every one of the 106 tests has therefore passed
on this commit, across the full run and the rerun.

The release candidate before this pass (`3e90bf47`, the same tree as
`0dce509b`) also passed all 106.

## Not run

- Slither, Foundry fuzzing and formal verification: not run in this pass.
  A passing hardhat suite is not formal verification.
- Mobile (Jest/Expo, Android, iOS) suites: no mobile code changed.
- Any production or staging traffic.
