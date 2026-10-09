# Remaining blockers — ordered by impact

1. **Rate-limit store over its Upstash plan limit (P0-05).** Production sign-in cannot start (passkey challenge 503), rails controls and readiness report down, and the partnership form returns 503. Owner: upgrade the Upstash plan. No code change can fix this without weakening fail-closed security.
2. **GitHub Actions billing (P0-03).** No commit has remote CI. Owner: fix billing in GitHub settings.
3. **Migration 0049 not applied (P3-01).** Partnership inquiries cannot be stored. Needs explicit authorization to run against the production database `iyarllmcednkbekweucd`.
4. **Deploy-gate release branch (P0-04).** Decide the release branch (`extension-redesign` default vs `release/partners-on-prod`) and stop bypassing the gate with dashboard promotes once CI runs.
5. **Travel suppliers (P2-01).** No live Duffel key; no activities or deals supplier; booking has no real payment rail. Each needs a contract and credentials.
6. **Price alerts (P2/P1-03).** In-memory and refused in production; needs persistent storage and a price monitor, or removal from navigation (product decision).
7. **Untested browsers (P4-01) and unmeasured performance (P5-03).** Firefox, WebKit, real iOS/Android devices and Lighthouse/RUM were not available in this environment.
