# FurlPay × Arc Network — completion scorecard

Audit date 2026-10-09, branch `feat/sui-collection` @ `6e4ff212`. Scores are
judgments from the evidence in `ARC_NETWORK_INTEGRATION_AUDIT.md`; each row
says why. Nothing unverified received full credit, and no Arc transaction has
ever been executed or received by FurlPay, which caps every "verified" score.

**FURLPAY × ARC NETWORK — INTEGRATION AUDIT**

- Overall integration: **44.5%**
- Code implementation: **66.5%**
- Verified functionality: **34%**
- Arc testnet readiness: **20%**
- Arc mainnet readiness: **15%**
- Production status: **Not Ready**
- Critical blockers (P0): **0**
- High-priority gaps (P1): **5**
- Missing integrations: **7** (Arc send, Arc signer/rail registration, router on Arc, collection addresses, native-send detection, mobile Arc UI, CCTP execution)

## Weighted score

| Component | Weight | Score | Weighted | Evidence | Missing work | Priority |
|---|---:|---:|---:|---|---|---|
| Arc RPC / config | 10 | 80 | 8.0 | Chain ids, RPC, USDC 6dp, explorer, 20 gwei floor, CCTP domain all verified live; merchant reader has per-endpoint chain proof + failover (`rpc.ts`) | Secondary Arc RPC; failover in `chainRegistry`/`/api/chain/rpc`; stale docs | P5, P6 |
| Wallets / signing | 10 | 30 | 3.0 | Injected-wallet signing with `assertChain` (checkout, payroll); native `arc` RPC slug | `arcSigner()` null; no Arc send in web or native | P1 |
| USDC payments / execution | 15 | 25 | 3.75 | Payroll per-chain domain; `arcExecutionAdapter` (tests only) | Router not on Arc; adapter unregistered; payroll screening lacks Arc blocklist | P1, P2, Pn |
| Merchant settlement | 15 | 55 | 8.25 | Full collection pipeline (verify, ledger, webhooks, refunds, receipts) tested generically; Arc decimals/blocklist views verified live | Native-send detection; custody addresses; first real Arc payment | P1 |
| Cross-chain | 10 | 45 | 4.5 | CCTP V2 calldata + Iris; domain 26 and mainnet contracts verified live | Never executed; native CCTP UI; float amount | P2, P6 |
| Smart contracts | 10 | 35 | 3.5 | FurlPayRouter 31 tests; `deploy-arc.ts` pre-flights | Audit; testnet then mainnet deployment; Arc-fork tests | P1, P6 |
| APIs / database | 10 | 55 | 5.5 | Merchant/payroll/v1 APIs; migrations 0040–0046 tested on PG18 | Migrations unapplied; `/api/v1/payments/execute` cannot reach Arc | P3 |
| Mobile / UI | 5 | 35 | 1.75 | Web checkout + payroll offer Arc | Mobile Arc screens; Wear OS / iOS / extension have no Arc | P4 |
| Security / reconciliation / monitoring | 10 | 60 | 6.0 | isBlacklisted screening at a canonical block; chain-verified reconciliation; liveness alerts | Native-send blind spot in reconciliation; Arc metrics/alerts; `arcCompliance` unused | P2, P5 |
| Production / e2e | 5 | 5 | 0.25 | Read-only live checks only | Any deployment; any Arc transaction | P1 |
| **Total** | **100** | | **44.5** | | | |

## The other percentages, and how they were computed

Same weights, different evidence bar per category:

| Category | Code (exists, wired) | Verified (tests + live) | Testnet-ready | Mainnet-ready |
|---|---:|---:|---:|---:|
| RPC/config | 90 | 80 | 80 | 80 |
| Wallets | 40 | 20 | 10 | 5 |
| Payments | 50 | 15 | 10 | 5 |
| Merchant | 75 | 40 | 10 | 15 |
| Cross-chain | 70 | 35 | 30 | 25 |
| Contracts | 70 | 30 | 20 | 5 |
| APIs/DB | 75 | 40 | 20 | 15 |
| UI | 45 | 15 | 15 | 15 |
| Security | 75 | 45 | 20 | 20 |
| Production | 50 | 0 | 0 | 0 |
| **Weighted** | **66.5** | **34** | **≈20** | **≈15** |

Testnet is barely above mainnet because merchant collection has **no testnet
mode** (registry is mainnet-only) and nothing is deployed to Arc testnet.

## Remaining 55.5 points by priority

Each category's gap (weight × (100 − score)) was assigned to the finding that
closes it (`ARC_NETWORK_PRODUCTION_GAPS.md`):

| Priority | Points | Share of remaining |
|---|---:|---:|
| P0 | 0 | 0% |
| P1 | 30.0 | 54% |
| P2 | 9.5 | 17% |
| P3 | 4.5 | 8% |
| P4 | 3.25 | 6% |
| P5 | 2.5 | 5% |
| P6 | 3.5 | 6% |
| P7 | 0 | 0% |
| P8 | 0 | 0% (not defined in the brief) |
| P9 | 0 | 0% (not defined in the brief) |
| Pn | 2.25 | 4% |
| **Total** | **55.5** | **100%** |
