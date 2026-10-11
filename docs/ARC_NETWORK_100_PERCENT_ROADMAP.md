# FurlPay × Arc Network — roadmap to 100% verified integration

From 44.5% (2026-10-09). Order follows the findings in
`ARC_NETWORK_PRODUCTION_GAPS.md`: P1 → P7, with Pn verified along the way.

## Phase A — repository-only (no credentials), ~1–2 weeks

| # | Item | Reuse | Change | Tests / acceptance | Effort |
|---|---|---|---|---|---|
| A1 | ARC-P1-001 + P2-003 native-send detection | `arcCreditableTransfers` in `lib/chains/arc.ts` | Arc branch in `verifier.ts` and `reconcile.ts` reading both Transfer streams, credit once at 6 dp, hold dust | Recorded mainnet native-only and dual-log receipts credit exactly once; a system-emitter value never compared at 6 dp | 1–2 d |
| A2 | ARC-P2-004 Arc blocklist in payroll/refunds/contractors | `assertArcPartiesClear` (`arcCompliance.ts`) | Call it for `arc` in `screenRecipient`, `setPayoutAddress`, `requestRefund` (fail closed) | Testnet blocked address refused in all three | 1 d |
| A3 | ARC-P2-001 Arc testnet collection | merchant registry, deposit policy | `arc-testnet` entry behind a non-production flag | Checkout on testnet end to end (after A1) | 1–2 d |
| A4 | ARC-P3-002 / P5-001 failover everywhere | `endpointsFor`/`proveChain` in `merchant/rpc.ts` | Use in `chainRegistry`, `/api/chain/rpc`, x402 | Wrong-chain endpoint refused; failover test | 1 d |
| A5 | ARC-P6-002 CCTP amount | `parseUsdc` | String amount → bigint | Rounding tests | 0.5 d |
| A6 | ARC-P4-001 native-app Arc send/receive/CCTP screens | `native-app/lib/evm/rpc.ts`, `cctp/*` | Screens with 18-dp fee display, `0x3600` transfers | Unit + device test | 3–5 d |
| A7 | ARC-P6-001 docs | this audit | Update `docs/arc/*` statuses | Docs match evidence | 0.5 d |
| A8 | ARC-P5-002 monitoring | liveness alerts | Arc head-lag and RPC-failure alerts | Alert fires on stale head | 1 d |

## Phase B — needs credentials or test funds (testnet), ~1–2 weeks

| # | Item | Dependency | Acceptance |
|---|---|---|---|
| B1 | ARC-P1-003 router on **Arc testnet** via `deploy-arc.ts` | testnet deployer + owner keys, faucet USDC | `eth_getCode` = artifact; payroll e2e green on Arc testnet; Pn-002 closed |
| B2 | ARC-P2-002 CCTP testnet round trip Arc ↔ Base Sepolia | testnet funds | burn → Iris attestation → mint observed both ways |
| B3 | ARC-P1-004 KMS signer + adapter registration (testnet) | KMS provider credentials | agent payment executes on testnet only after approval; signer failure → 503 |
| B4 | ARC-P6-003 Arc contract tests | B1 | blocklist/zero-address/fee-floor behaviours asserted |
| B5 | ARC-Pn-001 / Pn-003 | Circle support / docs | written confirmation recorded in `docs/arc` |

## Phase C — production (approvals, contracts, real funds), ~2–6 weeks

| # | Item | Dependency | Acceptance |
|---|---|---|---|
| C1 | ARC-P3-001 apply migrations 0040–0046 | owner approval | runbook steps pass on staging then production |
| C2 | ARC-P1-002 custody-controlled Arc collection addresses | custody contract | addresses registered with proof of control |
| C3 | ARC-P1-003 router audit + mainnet deployment | audit report, approval, owner/treasury keys | check-env green for `FURLPAY_ROUTER_ADDRESS_ARC` |
| C4 | ARC-P1-004 mainnet rail (`ARC_MAINNET_ACTIVATED`) | KMS, funded signer, `ARC_PRODUCTION_ACTIVATION.md` boxes | first live payment within limits, reconciled |
| C5 | ARC-P1-005 user sends (native app release) | store release | send on Arc from the app, balance and fee correct |
| C6 | First real Arc payment, refund, payroll | all above | journals balanced, webhooks delivered, reconciliation clean |

## Immediately actionable vs blocked

- **Now, in the repository:** A1, A2, A4, A5, A7, A8 (and A3/A6 code).
- **Blocked externally:** custody addresses (C2), router audit/deployment (B1/C3), KMS signer (B3/C4), hosted migrations (C1), Circle confirmations (B5).

## What 100% means here

Every row of the scorecard verified on Arc itself: a real payment detected via
either Transfer stream and credited once; a refund and a payroll batch executed
and reconciled; CCTP in and out of Arc; agents paying through the registered rail
under approval; monitoring alerting on Arc RPC failure; all on mainnet after the
same flow passed on testnet.
