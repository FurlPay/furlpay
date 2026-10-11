# Arc: what is code-complete vs what needs the outside world

Two columns, kept apart on purpose. Conflating them is how a project reports
itself as nearly done when the remaining work is the part it cannot do alone.

Written 2026-09-28. **Updated 2026-10-09** after the remediation pass — rows
marked (10-09) changed; commit hashes are on branch `feat/sui-collection`.

---

## CODE COMPLETE — no external dependency, done in this repository

| Item | Where | Evidence |
|---|---|---|
| Arc chain model (IDs, RPC, explorer) | `lib/chains/arc.ts` | Matches official docs; verified in `ARC_DEPENDENCIES.md` §1 |
| 18dp native ↔ 6dp ERC-20 handling, 10¹² scale | `lib/chains/arc.ts` | `ArcPrecisionError`, `assertErc20Scale`; 92 tests |
| Dual `Transfer` emitter disambiguation | `lib/chains/arc.ts` | `ARC_SYSTEM_EMITTER`, `arcLogStream()`; `arcDualEmitter.spec.ts` |
| Arc fee floor, forbidden transfers, failure classification | `lib/chains/arc.ts` | `arcTransactionRules.spec.ts` |
| **Arc execution adapter** | `lib/chains/arcExecutionAdapter.ts` | **New.** 18 adversarial tests |
| Chain-id proof before signing | same | Wrong-chain and Arc-mainnet-vs-testnet tests |
| Bounded receipt wait | same | Found by its own test hanging; `receiptTimeoutMs` |
| Gas ceiling | same | `ARC_GAS_CEILING = 200_000n` |
| Arc rail row in the capability registry | `packages/control-plane/src/capability.ts` | `access: "sandbox"` with an explicit blocker |
| Arc networks in the recipient registry | `packages/control-plane/src/recipient.ts` | `arc`, `arc_testnet` — required for attestation |
| `ARC_RAIL_LIVE` money flag with requirements | `lib/flags.ts` | Declares `FURLPAY_KMS_PROVIDER`, `ARC_RPC_URL` |
| Mainnet double-gate | `arcRailAdapter()` | `ARC_MAINNET_ACTIVATED` checked separately |
| CCTP burn/attestation/mint orchestration | `lib/services/cctpExecution.ts` | Pre-existing; calls Circle's real Iris API; exact burn amounts (10-09, `412f6f99`) |
| (10-09) Native Arc USDC sends credited, reconciled, refundable | `lib/payments/merchant/verifier.ts` `scanArc`, `reconcile.ts`, `refunds.ts` | `e82e7f0f`; `arcCollection.spec.ts`, `refunds.spec.ts` |
| (10-09) Arc USDC blocklist screening, fail-closed | `lib/compliance/addressScreening.ts` | `f8f756ad`; `arcScreening.spec.ts` |
| (10-09) Wallet RPC proxy with proven-endpoint failover | `app/api/chain/rpc/route.ts`, `rpc.ts` `proxyRpc` | `33ade752`; `proxyFailover.spec.ts` |
| (10-09) Arc testnet collection, never in production | `registry.ts`, migration 0047 | `baa63d56`; `arcCollection.spec.ts`, `database-0043.spec.ts` |
| (10-09) KMS Arc signer + automatic rail registration | `arcExecutionAdapter.ts` `arcSigner`, `railAdapter.ts` | `36e2b149`; `arcSigner.spec.ts` (real signature recovered) |
| (10-09) Arc chain health + alerts | `lib/payments/merchant/chainHealth.ts` | `0654d326`, `faa83c5f`; `chainHealth.spec.ts` |
| (10-09) Self-custodial Arc send in the native app | `native-app/lib/arc/send.ts`, `app/arc-send.tsx` | `b3b9635c`; `arcSend.test.ts` |

---

## EXTERNAL ACTIVATION — cannot be completed from this repository

| Requirement | Blocks | Who provides it | Status |
|---|---|---|---|
| **KMS/Turnkey signing key** | Server-side Arc sends. `arcSigner()` is implemented (10-09) and returns `null` until a KMS is configured, so the rail never registers | KMS vendor + FurlPay ops | **MISSING** (code ready) |
| **Arc testnet gas + USDC** | Any testnet transaction | Arc faucet | **MISSING** |
| **Verified Arc mainnet RPC** | Mainnet only | Circle/Arc docs or an RPC provider | **VERIFIED** (10-09): chain id 5042, fresh head |
| **Secondary RPC endpoint** | Failover | RPC provider | **MISSING** |
| **Contract audit** | Only if contracts are deployed (see below) | External auditor | **NOT DONE** — nothing in `packages/contracts/` is audited |
| **CCTP mainnet addresses** | CCTP into Arc | Circle's official CCTP reference | **VERIFIED on-chain** (10-09): `0x28b5…`/`0x81D4…` have code, domain 26 |
| Arc finality policy | Correct `SETTLED` semantics | Circle's finality documentation | **SET** (10-09) from docs.arc.io: 1 confirmation, bounded finality |
| Merchant collection addresses on Arc | Real Arc checkouts | Custody provider | **MISSING** (ARC-P1-002) |

---

## The honest shape of the remaining work

**The rail is one dependency away from testnet, and that dependency is a signer.**
(10-09: the signer *code* now exists; the dependency is the provisioned KMS key
and a funded testnet address.)

Everything between `authorize` and `submit` exists and is tested: the amount is
validated, the destination is canonicalised, the chain proves its identity, gas
is bounded, and every unknown outcome is INDETERMINATE rather than failed. What
is missing is the thing that turns a constructed transaction into a signed one.

That is not a small remaining task — it is the *only* remaining task for
testnet, and it is external. No amount of further work in this repository
produces an Arc transaction.

### Order of operations

1. **Provision the KMS key.** Unblocks Arc *and* x402 — they share a signer.
2. ~~Implement `arcSigner()` against it.~~ Done (10-09, `36e2b149`).
3. **Fund an Arc testnet address.**
4. **One testnet transfer.** Record it in `docs/deployments/ARC-TESTNET.md` with
   a real explorer link, or do not record it.
5. **Reconcile it**, including the dual-emitter case.
6. Only then consider mainnet, against `ARC_PRODUCTION_ACTIVATION.md`.

### What must not happen

- Arc marked `live` because a testnet transaction succeeded. Testnet value is
  not value.
- A raw private key used "just for testnet" on a path production can reach.
- Contracts deployed because they exist. The plain ERC-20 path needs none, and
  none of them is audited.
- CCTP built against V1 selectors. Arc rejects them.
