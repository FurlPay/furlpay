# Arc deployment architecture — what to deploy, and what not to

**Compiled 2026-09-25.** Facts cited here are established in
[`ARC-CIRCLE-OFFICIAL-REFERENCES.md`](./ARC-CIRCLE-OFFICIAL-REFERENCES.md).

## Current state, measured

| Question | Answer | How established |
|---|---|---|
| Contracts deployed to Arc mainnet | **None** | No addresses recorded anywhere in the repo; no `deployments/` directory; no Hardhat/Ignition broadcast artifacts |
| Contracts deployed to Arc testnet | **None** | same |
| Contracts deployed to *any* chain | **None** | same |
| Contracts written | **13** (one an interface) + 2 mocks | `packages/contracts/contracts/` |
| Arc networks configured in Hardhat | **Yes** — `arcTestnet` (5042002), `arcMainnet` (5042) | `hardhat.config.ts` |
| Arc deploy scripts | **No** | `package.json` has `deploy:sepolia`/`deploy:arbitrum` only |

So the honest answer to "enter your Arc mainnet contract addresses" is **there
are none**, and the honest answer to "are you live on Arc" is **no**. Nothing in
this document changes that; it plans the first step.

## The inventory, and the deployment verdict for each

1,479 lines of Solidity across 15 files. The goal is the **smallest**
production-ready Arc settlement surface, so the default for every contract is
*do not deploy* and each one has to earn an exception.

The test applied is not "is it good code" but **"does anything call it"**. An
unreachable deployed contract is pure liability: it holds an owner key, widens
the audit surface, and invites a future caller to use it before it has been
reviewed for that use.

| Contract | Lines | Wired consumer? | Verdict |
|---|---|---|---|
| **`FurlPayRouter.sol`** | 151 | **YES** — `lib/services/payments.ts` builds the EIP-712 domain with it as `verifyingContract`; `FURLPAY_ROUTER_ADDRESS` is a declared env var; `/api/payments/batch` and `/api/payouts/payroll` target `batchPay` | **DEPLOY — testnet first** |
| `X402Facilitator.sol` | 151 | No. `FACILITATOR_EVM_ADDRESS` is the fee-payer **EOA**, not this contract. No env var, no call site. | **Do not deploy yet** |
| `FurlPayEscrow.sol` | 173 | No env var, no call site | Do not deploy |
| `BookingReceipt.sol` | 47 | No env var, no call site | Do not deploy |
| `CanonicalFURL.sol` | 124 | No | **Do not deploy — see the warning below** |
| `compliance/SanctionsRegistry.sol` | 53 | No | **Do not deploy on Arc — obsoleted here** |
| `compliance/SanctionsCheck.sol` | 68 | No | Do not deploy on Arc |
| `compliance/PolicyManager.sol` | 69 | No | Do not deploy |
| `compliance/AttestationRegistry.sol` | 102 | No | Do not deploy |
| `compliance/SourceOfFundsCheck.sol` | 49 | No | Do not deploy |
| `compliance/ComplianceEscrow.sol` | 161 | No | Do not deploy |
| `compliance/X402PolicyWrapper.sol` | 208 | No | Do not deploy |
| `compliance/IComplianceCheck.sol` | 37 | — interface | Not deployable |
| `test/MockUSDC.sol` | 68 | test only | **Never** |
| `test/MockSanctionsOracle.sol` | 18 | test only | **Never** |

### The answer: one contract

**The minimum production-ready Arc settlement surface is `FurlPayRouter` alone.**

It is the only contract with a real consumer, and deploying it is the only thing
that converts an existing fail-closed code path into a working one. Everything
else would be deployed *because it exists*, which is the thing this exercise
exists to avoid.

### Why the compliance contracts are obsolete on Arc specifically

This is not a deferral; it is a design conclusion.

`SanctionsRegistry` + `SanctionsCheck` exist to mirror a Chainalysis
sanctions-oracle answer on-chain, because on Arbitrum the enforcing token has no
queryable list. On Arc that is not the situation:

- **MEASURED**: the Chainalysis oracle is not deployed on Arc.
- **MEASURED**: Arc's USDC *itself* answers `isBlacklisted(address)` — verified
  TRUE on testnet for Arc's published test address, false on mainnet.

So on Arc the enforcing contract is directly queryable, and a mirrored registry
would be a *second* list that can drift from the one that actually reverts the
transfer. Deploying it would make compliance worse, not better.

Implemented instead in `apps/web/src/lib/chains/arcCompliance.ts`, off-chain and
with no deployment: `screenArcAddress`, `assertArcPartiesClear`. See
[`ARC-COMPLIANCE-DECISION.md`](./ARC-COMPLIANCE-DECISION.md).

### The `CanonicalFURL` warning

FURL already exists as an SPL token on **Solana mainnet** (mint
`FYatJq71…`, 6 decimals, 1B supply). Deploying `CanonicalFURL` on Arc would
create a **second, unrelated token with the same name and no bridge between
them**. Holders of either could reasonably believe they hold the other.

That is not a deployment decision, it is a token-design decision with legal
exposure, and it is out of scope for an Arc settlement deployment. Do not deploy
it as part of this work.

## What FurlPayRouter needs in order to work on Arc

The contract is written for Arbitrum. Reviewed line by line against Arc's
differences, here is what holds and what does not.

### Holds without change

| Concern | Why it is fine on Arc |
|---|---|
| `amount` documented as "USDC, 6 decimals" | Correct. The contract moves USDC through the **ERC-20 interface**, which is 6dp on Arc. Arc's docs confirm the ERC-20 interface exists precisely for `transferFrom`/`approve`/`allowance`. |
| `usdc.safeTransferFrom(...)` | **MEASURED** — Arc's USDC is a full FiatTokenV2 (`DOMAIN_SEPARATOR`, `nonces`, `blacklister`, `masterMinter`, `paused` all answer). Standard ERC-20 semantics. |
| Cross-chain signature replay | Prevented. OpenZeppelin's `EIP712` includes `chainId` **and** `verifyingContract` in the domain separator and recomputes when `block.chainid` changes, so an authorization signed for Arbitrum (42161) cannot be replayed on Arc (5042) even at an identical contract address. |
| `block.timestamp > p.deadline` | Safe. Arc timestamps have 1-second granularity and sub-second blocks may **share** one, but this comparison assumes no uniqueness. |
| `PREVRANDAO` | Not used anywhere in the contract. Arc always returns 0. |
| Zero-address recipient check | Redundant-but-correct: Arc's USDC reverts on a zero-address transfer anyway (`"Zero address not allowed"`). Belt and braces. |
| `Ownable2Step` | Two-step ownership transfer. Appropriate for a production owner. |
| solc `evmVersion: "cancun"` | Safe. Arc's baseline is **Osaka**, which is a superset of Cancun, so `mcopy` and friends are available. Targeting `osaka` is optional, not required. |

### Does not hold — must be addressed before deployment

| # | Issue | Consequence |
|---|---|---|
| **A1** | **Doc/code mismatch in `batchPay`.** The docstring says "up to 100 authorizations"; the code enforces **no limit at all** (`ps.length` is unbounded). | Not a fund-safety bug — an oversized batch exhausts block gas and reverts. But it is a false statement in a contract about to be audited, and the kind of claim that gets repeated into a security review as though it were enforced. **Fix: enforce the documented bound, or delete the claim.** |
| **A2** | **One blocklisted party fails the whole batch.** On Arc, a transfer to *or from* a blocklisted address reverts, and `batchPay` is a single transaction. One blocklisted recipient in a 100-payment payroll run reverts all 100. | An availability problem specific to Arc's enforcement model, and a cheap griefing vector. Mitigation is off-chain: screen every party with `assertArcPartiesClear` **before** building the batch. Doing it on-chain would mean try/catch per item, which changes atomicity semantics and is a design decision, not a fix. |
| **A3** | **`feeTreasury` becoming blocklisted is a total outage.** Every `fee > 0` payment reverts. | `setFeeTreasury` (owner) and `pause()` exist, so it is recoverable — but only if it is *detected*. Needs the treasury address added to a monitored screening set, not just counterparties. |
| **A4** | **The 20 Gwei fee floor is off-chain and unguarded on this path.** `lib/chains/evmAdapter.ts` falls back to 1 Gwei when `eth_gasPrice` is unavailable — 20× too low. | An underpriced Arc transaction is **silently dropped with no receipt**, indistinguishable from pending, so a relayer submitting `pay()` would hang forever rather than fail. `assertArcFeeFloor` exists in `lib/chains/arc.ts`; **it is not yet wired into the relayer path.** Must be, before any Arc submission. |
| **A5** | **Zero-amount payments are permitted.** `amount == 0` with `fee == 0` passes every check, consumes a nonce, and emits `PaymentExecuted`. | Low severity: gas-bounded, and the payer must sign it. But it puts a settlement event in the log for a payment that moved nothing, which any downstream indexer will faithfully record. |

None of A1–A5 is a fund-loss bug. A4 is the one that would produce a
user-visible stuck payment on day one.

## Off-chain code that must change before Arc settlement is real

Deploying the contract is not the same as being able to use it. These are in
`apps/web`, not in Solidity.

| # | Where | What |
|---|---|---|
| **B1** | relayer / tx build path | Call `assertArcFeeFloor(maxFeePerGas, …)` on every Arc transaction. Build-path only — after submission there is no signal. |
| **B2** | `lib/travel/settlementProof.ts` | Currently requires the log emitter to equal the USDC contract, so a **plain native Arc send proves nothing** — and on a chain where USDC is the gas token that is the ordinary way to pay. Must use `arcCreditableTransfers`. **Critically: the fix must convert scales.** Adding the system emitter to the accepted set without converting turns a rejected payment into a 10¹² under-accept (an expectation of $1 satisfied by $0.000000000001). |
| **B3** | any deposit indexer | Must not sum both Transfer streams. One `transfer()` emits both; they are two views of one movement. `arcCreditableTransfers` de-duplicates. |
| **B4** | settlement confirmation | Check `receipt.status` on every Arc transfer. A mined Arc transfer may have moved nothing (blocklist, burn, zero address). Use `classifyArcTransferFailure`; never retry a `blocklisted` result. |
| **B5** | pre-flight | `assertArcPartiesClear` on both payer and recipient before building a batch (mitigates A2). |
| **B6** | deployer funding | **The deployer must hold USDC on Arc, not ETH.** Gas is USDC. A key funded with ETH has nothing to pay with and every transaction fails at estimation. |

B1–B4 have implementations in `lib/chains/arc.ts` and
`lib/chains/arcCompliance.ts` with 88 tests. **None of them is wired into a
settlement path yet** — `lib/chains/arc.ts` is currently imported only by its own
tests. That gap is the difference between "the guard exists" and "the guard
runs", and it is the honest status today.

## Deployment shape

One contract, three constructor arguments, no proxy.

```
FurlPayRouter(
  usdc_       = 0x3600000000000000000000000000000000000000   // Arc USDC ERC-20 iface
  feeTreasury_= <a FurlPay-controlled address, screened clear>
  owner_      = <a FurlPay-controlled address, NOT the deployer EOA>
)
```

**No proxy, deliberately.** An upgradeable router is an upgradeable path to every
user's USDC allowance. `Pausable` plus a redeploy-and-repoint is a smaller
attack surface than an upgrade key, and `FURLPAY_ROUTER_ADDRESS` already makes
repointing a config change. If it is ever upgraded, note EIP-712: the domain
separator binds `verifyingContract`, so a new address invalidates in-flight
authorizations — which is the safe direction.

**Owner must not be the deployer EOA.** The deployer key exists to send one
transaction; the owner key can redirect all fees and pause the rail. Separate
them at deployment, because changing it afterwards is an extra transaction
someone will skip.

### Address and key hygiene

- `ARC_MAINNET_DEPLOYER_PRIVATE_KEY` is a **separate** Hardhat `accounts` entry
  from every other network — already configured that way, deliberately, so a
  testnet run with the wrong `--network` cannot sign with a production key.
- Source verification on Arc's explorer is documented as requiring permissioned
  access, so `etherscan.apiKey` is left **unset** rather than pointed at a
  guessed `customChains` URL. Verification is the one deployment step worth doing
  by hand.

## Sequence

Each step's exit condition is a thing that can be checked, not a judgement.

| Step | Exit condition |
|---|---|
| 0. Fix A1, A4/B1 | `batchPay` bound enforced or claim removed; `assertArcFeeFloor` called on the Arc tx path with a test proving a 1 Gwei fee is refused |
| 1. Compile for Arc | `hardhat compile` clean; bytecode size recorded |
| 2. Write `scripts/deploy-arc.ts` | Refuses to run against chainId 5042 unless an explicit mainnet flag is set |
| 3. Fund the testnet deployer **in USDC** | Non-zero `eth_getBalance` on 5042002 (faucet: `https://faucet.circle.com`) |
| 4. **Deploy to testnet 5042002** | Address recorded in `docs/deployments/arc-testnet.md` with its tx hash and block |
| 5. Exercise it on testnet | A real `pay()` succeeds; **and a payment involving `0x70997970…79C8` reverts** (Arc's published blocklisted test address — the only way to exercise the blocklist path without a real sanctioned party) |
| 6. Wire B2–B5 | Tests green, and each guard demonstrably reachable from a settlement path |
| 7. Security review | [`ARC-SECURITY-REVIEW.md`](./ARC-SECURITY-REVIEW.md) with every finding resolved or explicitly accepted |
| 8. Mainnet | Only against the checklist in the mainnet runbook, with no unchecked item |

**Steps 3 onward are blocked on credentials this project does not have** — a
funded Arc deployer key. That is a hard stop, not a scheduling problem, and no
amount of further code removes it.

## What deploying one contract does and does not achieve

Stated plainly, because this is where a deployment gets overclaimed.

**Would become true:** a `FurlPayRouter` exists at a recorded Arc address; a
payer's EIP-712 authorization can be executed on Arc; USDC moves; the fee accrues.

**Would remain false:** that FurlPay is "live on Arc" in any product sense. One
router is not travel escrow, x402 settlement, booking receipts, or cross-chain
CCTP flows — none of which has a deployed counterpart or a wired consumer. It
would also remain **unaudited**: 151 lines reviewed by its authors is not a
third-party audit, and nothing in this document substitutes for one.
