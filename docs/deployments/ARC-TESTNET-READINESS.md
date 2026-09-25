# Arc testnet deployment readiness

**Status: NOT DEPLOYED.** No FurlPay contract has been deployed to Arc testnet
or Arc mainnet. `ONCHAIN_SETTLEMENT_LIVE` remains off. FurlPay is **not live on
Arc** and nothing in this document should be read as saying otherwise.

Prepared 2026-09-25. Target: **Arc testnet, chain ID 5042002. Mainnet is out of
scope and explicitly gated.**

## Verified network facts

Checked against Circle's own documentation this session, not against blog posts
or a cached table.

| Fact | Value | Source |
|---|---|---|
| Arc testnet chain ID | `5042002` | Arc docs / network listings |
| Arc mainnet chain ID | `5042` | repo constant, previously read on-chain |
| Arc testnet RPC | `https://rpc.testnet.arc.io` | Arc docs |
| Arc testnet explorer | `https://testnet.arcscan.app` | Arc docs |
| Testnet USDC faucet | `https://faucet.circle.com` | Circle |
| Native gas token | **USDC** — not ETH | Arc docs |
| CCTP domain (Arc) | **26** | Circle CCTP EVM contracts page |
| TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | Circle CCTP docs |
| MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | Circle CCTP docs |
| TokenMinterV2 | `0xfd78EE919681417d192449715b2594ab58f5D002` | Circle CCTP docs |

**All of these match what the repo already encodes** in
`apps/web/src/lib/services/cctpExecution.ts` and `apps/web/src/lib/chains/arc.ts`.
No constant needed correcting.

Two consequences of USDC-as-gas that change deployment mechanics:

- The deployer must hold **USDC on Arc**, not ETH. A funded key is a prerequisite,
  and testnet USDC comes from Circle's faucet.
- Gas estimation and any "insufficient funds" handling that assumes an 18-decimal
  native token will be wrong. Arc presents a dual interface — 18dp native, 6dp
  ERC-20 — and the pairing is exact (10^12).

**Unverified here:** Arc's minimum base fee behaviour. A prior investigation
found a 20 Gwei minimum with *silent drop and no receipt* below it. That is the
single most likely cause of a deploy that appears to hang, and it has not been
re-confirmed against current docs. Treat it as a live risk, not a settled fact.

## Minimum contract set for the first testnet milestone

The repo has 15 Solidity sources. **Deploy 3.** The rest are either not required
for a settlement milestone, are test-only, or belong to a different product line.

| Contract | Deploy? | Why |
|---|---|---|
| `FurlPayRouter` | **yes** | The settlement entrypoint. Per-payer nonces, `MAX_BATCH`, `MAX_DEADLINE_WINDOW`. Nothing else provides the batch-payment surface. |
| `X402Facilitator` | **yes** | The x402 verify/settle surface the whole RFC is about. Without it the milestone tests nothing that distinguishes FurlPay. |
| `SanctionsCheck` | **yes** | Screening must exist on the path from the first deploy. Adding it later means a period where settlement runs unscreened. |
| `SanctionsRegistry` | **yes** (dependency) | `SanctionsCheck` reads it. On Arc it is the *only* working screen — see the blocker. |
| `FurlPayEscrow` | no | Not needed for a settle-path milestone. Defer until escrow flows are actually exercised. |
| `ComplianceEscrow`, `PolicyManager`, `AttestationRegistry`, `SourceOfFundsCheck`, `X402PolicyWrapper` | no | Policy layers above the minimum screen. Each adds admin surface and upgrade risk for no milestone value. |
| `BookingReceipt`, `CanonicalFURL` | no | Different product lines. |
| `MockUSDC`, `MockSanctionsOracle` | **never** | Test-only. Arc has real USDC; deploying a mock would create a token that looks real. |

Dependency order: `SanctionsRegistry` → `SanctionsCheck` → `FurlPayRouter` →
`X402Facilitator`.

## Constructor inputs required

Not yet supplied. **Every one of these is a blocker** — none may be invented.

| Contract | Argument | Status |
|---|---|---|
| `SanctionsRegistry` | `owner` | **MISSING** — needs a real address |
| `SanctionsCheck` | `owner`, `oracle`, `registry` | `oracle` must be `address(0)` on Arc (see blocker); `owner` **MISSING** |
| `FurlPayRouter` | `ARC_ROUTER_OWNER`, `ARC_FEE_TREASURY` | **MISSING** — flagged in an earlier session and still unanswered |
| `X402Facilitator` | owner, USDC address, router | USDC known; owner **MISSING** |

## BLOCKER — Chainalysis has no oracle on Arc

A prior audit found no contract code at the Chainalysis sanctions oracle address
on Arc, while the Arbitrum deployment at
`0x40C57923924B5c5c5455c48D93317139ADDaC8fb` exists.

**The code already handles this correctly, and not by weakening.** Reading
`contracts/compliance/SanctionsCheck.sol`:

- `oracle` is explicitly optional and may be `address(0)`;
- it is consulted inside try/catch so a missing or reverting oracle cannot brick
  screening;
- `SanctionsRegistry` — FurlPay's own OFAC-seeded list — is checked
  independently, and either source flagging is sufficient to block.

So on Arc the system degrades to **registry-only screening**. That is a real
control, not a bypass. But it is materially weaker than registry + oracle, and
it carries an operational obligation that the contract cannot enforce:

> The registry is only as current as the last time someone seeded it.
> `scripts/seed-sanctions.ts` exists; nothing guarantees it has been run, or that
> it is re-run when OFAC updates.

**Decision for testnet:** deploy with `oracle = address(0)`, registry seeded, and
the degradation recorded here rather than left implicit. This is acceptable on
testnet because no real value moves.

**Decision for mainnet: NOT ACCEPTABLE AS-IS.** Before any Arc mainnet
settlement, one of the following must be true, and the choice must be explicit:

1. Chainalysis deploys an oracle on Arc and the address is verified to hold code;
2. an equivalent attested screening source is integrated and its freshness
   guarantee documented;
3. screening moves off-chain in front of settlement, with the attestation bound
   into the payment so the on-chain path cannot be reached unscreened;
4. Arc settlement is restricted to counterparties screened on another chain.

Do not resolve this by lowering the check. A silent fallback to registry-only on
mainnet, with a stale registry, is indistinguishable from no screening.

## Pre-deploy commands

```bash
cd packages/contracts
npx hardhat compile
npx hardhat test          # must be green before any broadcast
```

Static analysis: check whether a slither/solhint config exists in the repo before
claiming it was run. **Not yet run as part of this preparation.**

## Deploy runbook (do not execute until the blockers clear)

```bash
# Prerequisites
#   - deployer key funded with TESTNET USDC (faucet.circle.com), not ETH
#   - ARC_ROUTER_OWNER, ARC_FEE_TREASURY resolved to real addresses
#   - registry seeded

export ARC_TESTNET_RPC=https://rpc.testnet.arc.io   # chainId 5042002
npx hardhat run scripts/deploy-compliance.ts --network arcTestnet
npx hardhat run scripts/deploy-arc.ts        --network arcTestnet
```

Verify each address holds code before proceeding to the next contract. A deploy
that returns a transaction hash but leaves no code at the address is the exact
failure mode Arc's minimum-base-fee behaviour would produce.

## Post-deploy smoke tests

1. `eth_getCode` non-empty at every deployed address.
2. `SanctionsCheck.isSanctioned(seededAddress)` returns true — proves the
   registry is actually populated, not merely deployed.
3. `SanctionsCheck.isSanctioned(cleanAddress)` returns false.
4. Router rejects a batch over `MAX_BATCH` and a deadline over
   `MAX_DEADLINE_WINDOW`.
5. Router rejects a zero amount.
6. A nonce cannot be replayed.
7. CCTP: a testnet burn on Arc produces an Iris attestation, and the mint leg
   builds. **The attestation endpoint fix (domain 26) must be deployed for this
   to work** — it was rejecting Arc before.

## Rollback / containment

Contracts are not upgradeable. Containment is:

1. pause, if the contract exposes it — confirm before deploying, not after;
2. revoke the router's token approvals;
3. point the backend away from the addresses (config, no on-chain action);
4. redeploy and re-point. Old contracts stay on-chain and must be treated as
   live until approvals are revoked.

## Mainnet gates — ALL must be met, in order

1. Testnet deployment complete and smoke tests green
2. End-to-end testnet settlement executed
3. Full CCTP lifecycle verified on testnet (burn → attest → mint)
4. **Compliance blocker resolved by one of the four options above**
5. External security audit — none has occurred
6. Owner/treasury addresses on a multisig, not an EOA
7. Monitoring and alerting live
8. Incident response documented and rehearsed
9. Deployed bytecode verified on the explorer
10. Explicit human approval

`ONCHAIN_SETTLEMENT_LIVE` stays off until every one of these is true.
