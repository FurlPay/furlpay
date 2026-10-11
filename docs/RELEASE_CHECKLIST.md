# Release checklist

Ticked = verified in this session (see `RELEASE_EVIDENCE.md`). Unticked = still to do.

## Engineering
- [x] Type check 0 errors (TS 5.5.3)
- [x] Full test suite: 7,635 passed; 2 known failures documented
- [x] Clean production build (`093e05c2`, 467 pages)
- [x] Migrations 0040–0046 apply on Postgres 18 and PGlite
- [x] Contract tests 31/31; payroll e2e on a local chain 3/3
- [ ] `releaseBranchGate` fix approved and applied (owner decision)
- [ ] `nativeParity` investigated with the Expo app's dependencies installed
- [ ] PR opened; CI green on the exact SHA

## Security
- [x] Defects found in this work fixed with regression tests (`PAYMENT_SECURITY_VERIFICATION.md`)
- [ ] FurlPayRouter independent audit
- [ ] Organization model + dual control for refunds/payroll above a threshold

## Environment (per environment)
- [ ] `npm run merchant:check-env` passes
- [ ] Migrations applied in order (staging first)
- [ ] Custody-controlled collection addresses registered with proof of control

## Go-live gates
- [ ] One real payment + refund per enabled chain on staging, books balanced
- [ ] Reconciliation and liveness alerts reviewed for a full day of staging traffic
- [ ] Owner approval for production migrations and deploy
