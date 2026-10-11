# Production readiness — verdict

**BLOCKED — EXTERNAL DEPENDENCIES** (code: ready for staging).

## Ready for staging (locally verified)
Merchant checkout on Arc, Base, Arbitrum, Polygon, Ethereum, Solana and Sui with
independent on-chain verification; payment links, invoices, QR terminal; PDF
receipts; webhooks with UI and test events; `/api/v1/payment-links`; refunds
(reserve → approve → on-chain-verified completion, EVM and Sui); reconciliation
and liveness alerts; RPC failover; pricing tiers; operator console; payroll
roster, invites, wallet-proven addresses, CSV import, batches, durable signing,
employer-executed `batchPay` with chain-verified recording; W-9/W-8BEN records;
1099-NEC watch.

## Blocks production
1. Hosted migrations 0040–0046 not applied (approval).
2. No custody provider: no production collection addresses; refunds cannot be sent.
3. FurlPayRouter unaudited and undeployed: payroll cannot execute.
4. CI has not run on these commits.
5. `releaseBranchGate` deploy-gate defect awaiting owner decision.

## Not offered (must not be claimed)
Virtual bank accounts, fiat off-ramps/FX, e-FIRA, Samsung Wallet integration,
NFC card acceptance, treasury yield, team roles/dual approval.

Details: `FURLPAY_FEATURE_INVENTORY.md`, `EXTERNAL_INTEGRATION_BLOCKERS.md`,
`DEPLOYMENT_RUNBOOK.md`, `RELEASE_EVIDENCE.md`.
