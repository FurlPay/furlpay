# Arc: what is code-complete vs what needs the outside world

Two columns, kept apart on purpose. Conflating them is how a project reports
itself as nearly done when the remaining work is the part it cannot do alone.

Written 2026-09-28.

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
| CCTP burn/attestation/mint orchestration | `lib/services/cctpExecution.ts` | Pre-existing; calls Circle's real Iris API |

---

## EXTERNAL ACTIVATION — cannot be completed from this repository

| Requirement | Blocks | Who provides it | Status |
|---|---|---|---|
| **KMS/Turnkey signing key** | Everything. `arcSigner()` returns `null`, so the rail never registers | KMS vendor + FurlPay ops | **MISSING** |
| **Arc testnet gas + USDC** | Any testnet transaction | Arc faucet | **MISSING** |
| **Verified Arc mainnet RPC** | Mainnet only | Circle/Arc docs or an RPC provider | **UNVERIFIED** — the repo constant was not independently re-confirmed |
| **Secondary RPC endpoint** | Failover | RPC provider | **MISSING** |
| **Contract audit** | Only if contracts are deployed (see below) | External auditor | **NOT DONE** — nothing in `packages/contracts/` is audited |
| **CCTP mainnet addresses** | CCTP into Arc | Circle's official CCTP reference | **UNVERIFIED** — recorded addresses describe testnet |
| Arc finality policy | Correct `SETTLED` semantics | Circle's finality documentation | **NOT SET** — deliberately not inherited from launch coverage |

---

## The honest shape of the remaining work

**The rail is one dependency away from testnet, and that dependency is a signer.**

Everything between `authorize` and `submit` exists and is tested: the amount is
validated, the destination is canonicalised, the chain proves its identity, gas
is bounded, and every unknown outcome is INDETERMINATE rather than failed. What
is missing is the thing that turns a constructed transaction into a signed one.

That is not a small remaining task — it is the *only* remaining task for
testnet, and it is external. No amount of further work in this repository
produces an Arc transaction.

### Order of operations

1. **Provision the KMS key.** Unblocks Arc *and* x402 — they share a signer.
2. **Implement `arcSigner()`** against it. Small, and the interface is fixed.
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
