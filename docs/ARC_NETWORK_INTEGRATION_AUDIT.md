# FurlPay × Arc Network — integration audit

Audit only; no code was changed. Scope: branch `feat/sui-collection` at
`6e4ff212` (the superset of production plus the unreleased merchant/payroll
work). Production (`furlpay.com`) runs an older line without merchant
collection or payroll. Date: 2026-10-09.

## 1. Evidence gathered

### Live, read-only checks against Arc (2026-10-09, from this machine)

| Check | Mainnet `https://rpc.mainnet.arc.io` | Testnet `https://rpc.testnet.arc.io` |
|---|---|---|
| `eth_chainId` | 5042 ✔ | 5042002 ✔ |
| Head freshness | current (block 25,020,152) | current (block 66,255,485) |
| `baseFeePerGas` | 20 gwei (= `ARC_MIN_BASE_FEE_WEI`) | 20 gwei |
| USDC `0x3600…0000` `decimals()` / `symbol()` | 6 / USDC ✔ | 6 / USDC ✔ |
| `isBlacklisted(0x7099…79C8)` (Arc's published test address) | false | **true** (as documented) |
| CCTP TokenMessengerV2 / MessageTransmitterV2 bytecode | present at `0x28b5…cf5d` / `0x81D4…4B64` | present at `0x8FE6…2DAA` / `0xE737…E275` |
| `MessageTransmitterV2.localDomain()` | **26** ✔ | **26** ✔ |
| Explorer | `explorer.arc.io` 200 | `explorer.testnet.arc.io` 200 |

No transaction was submitted. FurlPay has **never executed or received a
payment on Arc**: there are no collection addresses, no deployed FurlPay
contract and no server signer for Arc.

### Tests run

- Arc-specific suites (`arcCctp`, `arcDecimals`, `lib/chains/*` incl.
  `arcExecutionAdapter`, `arcPayload`, `networkCoverageConsistency`,
  `x402AssetPinning`, `travelSettlementProof`): **7 files, 144 tests passed**.
- Merchant/payroll suites exercise Arc only as one entry of a generic EVM
  registry (schema, chain lists); no Arc-specific payment test exists.
- Contract tests (31) and the payroll end-to-end run on Hardhat (chainId 42161),
  **not** on Arc or an Arc fork.

### Authoritative sources

- Arc docs, network/finality: https://docs.arc.io/arc-chain (sub-second
  deterministic finality, Malachite BFT; no reorg after commit).
- CCTP V2 contract addresses: https://developers.circle.com/cctp/references/contract-addresses
  (Arc domain 26; addresses confirmed on-chain above).
- Arc EVM differences: https://docs.arc.io/arc/references/evm-differences.

## 2. Where Arc lives in the code

| Area | Files | State |
|---|---|---|
| Chain model (decimals, dual Transfer streams, fee floor, failure classes) | `apps/web/src/lib/chains/arc.ts` | Implemented, heavily tested; used only by `lib/travel/settlementProof.ts` and `lib/integrity/evmPayload.ts` |
| Arc execution rail | `lib/chains/arcExecutionAdapter.ts` | Implemented + tested; **never registered** (no importer), `arcSigner()` returns `null`, flag `ARC_RAIL_LIVE` |
| Arc blocklist screening | `lib/chains/arcCompliance.ts` (`assertArcPartiesClear`) | Implemented + tested; **no production caller** |
| Chain registries | `lib/services/chainRegistry.ts`, `lib/x402Chains.ts`, `lib/payments/merchant/registry.ts`, `native-app/lib/evm/rpc.ts` | Arc 5042 / 5042002, USDC `0x3600…`, explorer — correct (verified live) |
| Merchant collection on Arc | `lib/payments/merchant/{registry,verifier,reconcile,refunds}.ts`, migrations 0040–0046 | Generic EVM path; Arc deposit policy 1 conf; **ERC-20-log-only detection** |
| Payroll on Arc | `lib/payroll/*`, `lib/services/routerConfig.ts` (`FURLPAY_ROUTER_ADDRESS_ARC`) | Per-chain EIP-712 domain supports Arc; **no router deployed on Arc** |
| Router deployment | `packages/contracts/scripts/deploy-arc.ts`, `hardhat.config.ts` (`arcMainnet`, `arcTestnet`) | Ready with pre-flights (fee floor, isBlacklisted, owner≠deployer); never run |
| CCTP | `lib/services/cctpExecution.ts`, `app/api/intents/cctp/*`, `native-app/lib/cctp/*` | Non-custodial calldata + Iris attestation incl. Arc (26); never executed; native client has no screen |
| Wallet transfers | `app/api/wallets/transfer/route.ts` | Mock ledger; **503 in production** for every chain incl. Arc |
| Capability gate | `packages/control-plane/src/capability.ts` | `arc_usdc_transfer`: `access: "sandbox"` |
| Docs | `docs/arc/*`, `docs/ARC-*.md` | Partly stale (see ARC-P6-001) |

## 3. Payment flows traced

| # | Flow | Entry / files | Status | Tests | Network evidence | Blockers |
|---|---|---|---|---|---|---|
| 1 | Create/connect Arc wallet | Injected wallets (EIP-6963) in checkout/payroll; native app is self-custody EVM with `arc` RPC slug | Partial: connect works generically; no FurlPay Arc wallet UX | generic wallet tests | none | No Arc network add/switch UX; no native Arc screens |
| 2 | Receive USDC on Arc | Native app balance via `/api/chain/rpc` (18dp native) | Partial | `native-app` rpc tests | none | No receive screen for Arc |
| 3 | Send USDC on Arc | `app/api/wallets/transfer` | **Not available**: 503 in production (mock) | route tests (mock) | none | No relayer/signer; native app has no Arc send |
| 4 | Merchant Arc payment request | `/p/[slug]`, `qr.ts` (EIP-681 `ethereum:0x3600…@5042/transfer?…`) | Implemented | `core.spec` | none | Collection addresses (custody) |
| 5 | Customer pays with Arc USDC | `HostedCheckout.tsx` (ERC-20 `transfer()` after `assertChain`) | Implemented for ERC-20 payments | generic | none | **Native sends undetected (ARC-P1-001)** |
| 6 | Confirmation updates status | `verifier.ts` `scanIntent` (logs from `0x3600`, receipt re-read, canonical block, 1 conf) | Implemented | `verifier-fixes.spec` (generic) | none | P1-001; no Arc payment ever observed |
| 7 | Merchant credited once | `merchant_payment_receive` (receipt PK, journal) | Implemented, DB-tested | `database.spec`, harness 0040 | none | migrations unapplied |
| 8 | Fees recorded | tier bps stamped on link; `mp:fees:arc` | Implemented | `operations.spec`, DB tests | none | — |
| 9 | Signed webhook | `webhooks.ts` | Implemented | `webhooks.spec` | none | `FURLPAY_PARTNER_WEBHOOK_KEY` |
| 10 | Failed/partial/duplicate/overpaid | statuses + hold + refunds 0045 | Implemented | DB + unit tests | none | Refund sending needs custody |
| 11 | AI agent Arc payment with authorization | `/api/v1/payments/execute` → rail adapters | **Not reachable**: Arc adapter never registered; no signer | adapter unit tests | none | KMS signer, deployment, registration |
| 12 | Cross-chain to/from Arc | `/api/intents/cctp` (burn/mint calldata, Iris) | Partial: calldata only, user signs | `arcCctp.spec` | contracts + domain verified live | Never executed; native UI missing |

## 4. Results

See `ARC_NETWORK_COMPLETION_SCORECARD.md` (scores and method),
`ARC_NETWORK_PRODUCTION_GAPS.md` (findings P0 → Pn) and
`ARC_NETWORK_100_PERCENT_ROADMAP.md` (remediation).
