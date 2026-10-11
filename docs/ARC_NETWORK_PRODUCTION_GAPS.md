# FurlPay × Arc Network — findings, P0 → Pn

Audit only (2026-10-09, `feat/sui-collection` @ `6e4ff212`). "Completed" = 0
everywhere because nothing was remediated in this audit. Effort is engineering
time for the repository work only.

**FURLPAY × ARC NETWORK — FINAL INTEGRATION AUDIT**

Overall Arc integration: **44.5%** · Arc mainnet readiness: **15%** · Arc testnet
readiness: **20%** · Production readiness: **Not Ready**

| Priority | Total findings | Completed | Remaining | Production blocker |
|---|---:|---:|---:|---|
| P0 | 0 | 0 | 0 | — |
| P1 | 5 | 0 | 5 | Yes (all) |
| P2 | 4 | 0 | 4 | Yes (P2-001, P2-004); no (others) |
| P3 | 2 | 0 | 2 | Yes (P3-001) |
| P4 | 1 | 0 | 1 | No |
| P5 | 2 | 0 | 2 | No |
| P6 | 3 | 0 | 3 | No |
| P7 | 1 | 0 | 1 | No |
| P8 | 0 | 0 | 0 | — (not defined in the brief) |
| P9 | 0 | 0 | 0 | — (not defined in the brief) |
| Pn | 3 | 0 | 3 | Pending verification |

---

## P0 — Critical

None found. Specifically checked and **not** present: wrong chain id or USDC
address (all verified live); 1e12 under-accept (the merchant verifier compares
only 6-dp ERC-20 logs and checks `decimals() == 6` on Arc); double crediting
(receipt PK + single stream); replay (receipt PK, router nonces); finality (Arc
is deterministic; 1 confirmation is consistent with Arc's documentation).

## P1 — High

### ARC-P1-001 — Merchant collection misses native Arc USDC sends
1. **Component:** merchant payment detection on Arc.
2. **Status:** implemented for ERC-20 `transfer()` only.
3. **Evidence:** `apps/web/src/lib/payments/merchant/verifier.ts` `scanIntent` → `eth_getLogs` with `address: c.token` (`0x3600…`); `lib/chains/arc.ts` (lines ~330–375) documents that a native-only movement emits **only** the system-emitter log (`0xffff…fffe`, 18 dp) — mainnet example tx `0xbb74a675…cec9`. `arcCreditableTransfers()` exists but is not used by the verifier; `reconcile.ts` has the same blind spot.
4. **Root cause:** detection filters on the ERC-20 interface address.
5. **Impact:** a payer who pastes the address into a wallet that shows USDC as Arc's native balance and presses Send pays successfully on-chain, but the checkout never sees it and expires; the funds sit unattributed at the collection address. No wrong credit, but stranded customer money and a failed sale. Checkout's own wallet button and QR (EIP-681 `transfer`) are unaffected.
6. **Fix:** for `arc`, scan the system-emitter stream too and normalise through `arcCreditableTransfers` (credit once, 18 dp → 6 dp, reject sub-6-dp dust or hold it); same in reconciliation.
7. **Tests:** unit with the recorded native-only and dual-log mainnet receipts; under-accept guard (system value compared at 6 dp must fail); duplicate-pair test; reconciliation test.
8. **Effort:** 1–2 days.
9. **Deployment dependency:** none beyond the release.

### ARC-P1-002 — No collection addresses on Arc (no custody provider)
1. Merchant acceptance on Arc. 2. Code complete; zero destinations. 3. `merchant_payment_destinations` empty; registration requires a custody signature (`destinations.ts`). 4. No custody provider contracted. 5. Every Arc checkout answers `rail_unavailable`. 6. Contract a custody provider supporting Arc (EVM addresses); register addresses with proof of control. 7. One real small payment + refund on Arc. 8. Integration 2–4 days after access. 9. **External:** custody contract, migrations applied.

### ARC-P1-003 — FurlPayRouter not deployed or audited on Arc
1. Payroll (and any router payment) on Arc. 2. Deploy script ready, never run. 3. `packages/contracts/scripts/deploy-arc.ts`; `FURLPAY_ROUTER_ADDRESS_ARC` unset; `npm run merchant:check-env` reports it missing. 4. No audit, no approval to deploy. 5. Payroll batches on Arc answer 503; nothing can execute. 6. Audit; deploy to **Arc testnet**, run payroll e2e against it; then mainnet with owner ≠ deployer and a separate fee treasury. 7. `payrollRouter.e2e.spec` against Arc testnet; `eth_getCode` matches artifact; source verified on explorer. 8. 2 days engineering + audit lead time. 9. **External:** audit, deployment approval, owner/treasury keys.

### ARC-P1-004 — Arc execution rail unreachable (no signer, never registered)
1. `/api/v1/payments/execute`, AI-agent payments on Arc. 2. Adapter implemented and tested, dead code. 3. `lib/chains/arcExecutionAdapter.ts` has no importer; `arcSigner()` returns `null`; flag `ARC_RAIL_LIVE`; `capability.ts` `arc_usdc_transfer` `access: "sandbox"`. 4. No KMS-backed signer; registration never wired. 5. Agents/APIs cannot pay on Arc. 6. KMS signer (same provider as x402), register adapter behind the flag, keep fail-closed. 7. Adapter registration test; KMS signer test; Arc testnet execution with an approval workflow. 8. 3–5 days after KMS access. 9. **External:** KMS credentials, funded testnet/mainnet signer.

### ARC-P1-005 — Users cannot send USDC on Arc from FurlPay
1. Wallet send. 2. Mock only. 3. `app/api/wallets/transfer/route.ts` returns 503 in production for every chain; native app has an `arc` RPC slug but no Arc send screen. 4. No relayer/paymaster; native UI not built. 5. No user-facing Arc transfers. 6. Either a native-app Arc send (self-custody, user signs; gas in USDC — `native-app/lib/evm/rpc.ts` already documents the 18-dp fee) or a server relayer (needs P1-004). 7. Native send unit tests + testnet send. 8. 3–5 days (native path). 9. Native path: none external; relayer path: KMS.

## P2 — Major

### ARC-P2-001 — No Arc testnet path for merchant collection or payroll
`lib/payments/merchant/registry.ts` lists mainnet chains only; payroll e2e runs on Hardhat 42161. Impact: no safe end-to-end rehearsal on Arc. Fix: an `arc-testnet` collection entry behind a non-production flag (testnet USDC is the same `0x3600` interface; `isBlacklisted` test address available). Tests: full testnet payment/refund. Effort 1–2 days. Dependency: testnet USDC from Circle's faucet.

### ARC-P2-002 — CCTP to/from Arc never executed end-to-end
`app/api/intents/cctp/*`, `lib/services/cctpExecution.ts` build calldata; `native-app/lib/cctp/*` has no screen (`pendingTransfer.ts` unused). Fix: testnet burn on Arc → mint on Base Sepolia (and reverse) with Iris; native UI. Effort 3 days. Dependency: testnet funds.

### ARC-P2-003 — Reconciliation inherits the native-send blind spot
`lib/payments/merchant/reconcile.ts` `checkReceipt` decodes only ERC-20 logs. Fixed together with P1-001. Effort included there.

### ARC-P2-004 — Payroll and refund screening ignore Arc's USDC blocklist
`lib/services/circleCompliance.ts` has no `arc` mapping, so `screenAddressRisk` is OFAC-only on Arc; payroll (`lib/payroll/repository.ts` `screenRecipient`), contractor addresses (`selfService.ts`) and refund addresses (`refunds.ts`) never call `isBlacklisted`. `arcCompliance.ts` (`assertArcPartiesClear`) exists unused. Impact: one blocklisted recipient reverts an entire `batchPay` (FurlPayRouter comment) and a refund would fail at the custody send. Fix: call `assertArcPartiesClear` for Arc in those three places (fail closed). Tests: Arc testnet test address `0x7099…79C8` blocks. Effort 1 day.

## P3 — Medium

### ARC-P3-001 — Hosted migrations 0040–0046 not applied
All merchant/payroll APIs return 503 without them. External approval; runbook in `docs/DEPLOYMENT_RUNBOOK.md`.

### ARC-P3-002 — x402 and the chain RPC proxy on Arc use a single endpoint and no live settler
`lib/x402Chains.ts`, `app/api/chain/rpc/route.ts`, `chainRegistry.ts` read `ARC_RPC_URL` (single) without per-endpoint chain proof; x402 settlement needs the KMS fee payer (not configured in production). Effort 1 day for failover reuse; settler external.

## P4 — Moderate

### ARC-P4-001 — No Arc in mobile, Wear OS, iOS Guardian or the extension
`native-app` has no Arc screens; `guardian/`, `ios/FurlPayGuardian`, `apps/extension` have no Arc chain support (the "arc" matches there are UI geometry). Web shows "Arc" as text (no official logo). Effort 3–5 days for the native app.

## P5 — Low

### ARC-P5-001 — No secondary Arc RPC configured
Failover exists in `lib/payments/merchant/rpc.ts`; only the public endpoint is configured. Add a provider (e.g. Chainstack/QuickNode Arc) to `ARC_RPC_URL`.

### ARC-P5-002 — No Arc-specific metrics or alerts
RPC health is in-memory per instance (`rpcHealth`); liveness alerts are generic. Add Arc head-lag and RPC-failure alerts.

## P6 — Minor

### ARC-P6-001 — Arc docs are stale
`docs/arc/ARC_PRODUCTION_ACTIVATION.md` ("Arc has never been contacted"), `docs/arc/ARC_DEPENDENCIES.md` §1 (mainnet RPC UNVERIFIED), §3 (CCTP mainnet addresses UNVERIFIED), §4 (finality unverified) — all verified on 2026-10-09 (see the audit).

### ARC-P6-002 — CCTP burn amount via floating point
`lib/services/cctpExecution.ts:189` `BigInt(Math.round(amount * 10 ** 6))` from a `z.number()` request field. Exact for ≤6 decimals within 1e12, but rounds silently otherwise. Use a decimal string → bigint parser (as `parseUsdc`).

### ARC-P6-003 — No Arc-specific contract tests
FurlPayRouter is tested on Hardhat only; Arc differences (blocklist revert, zero-address revert, 20 gwei floor) are untested against the contract. Add an Arc-testnet test run.

## P7 — Optional

### ARC-P7-001 — Gas abstraction on Arc
Users pay Arc gas in USDC directly; a Circle Paymaster on Arc is **not confirmed** (`docs/arc/ARC_DEPENDENCIES.md` §5). Revisit when Circle documents it.

## P8, P9

No findings. The brief defines priorities P0–P7 and Pn only; no definitions were
supplied for P8/P9, so nothing was assigned to them.

## Pn — Pending verification

### ARC-Pn-001 — Circle Compliance coverage of Arc
Whether Circle's Compliance Engine supports Arc addresses is unknown; the code maps no `arc` chain. Needs Circle confirmation.

### ARC-Pn-002 — ERC-20 `approve`/`transferFrom` behaviour of `0x3600` for FurlPayRouter
Expected to work (FiatTokenV2 interface) but never executed on Arc; verify with an Arc testnet payroll run (P1-003).

### ARC-Pn-003 — Primary-source confirmation of "1 confirmation is final"
Arc docs state deterministic sub-second finality; the explicit "treat 1 confirmation as final" wording found was from a third-party integration guide. Confirm against Circle's own exchange-integration guidance before mainnet volume.
