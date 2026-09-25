# Arc security review — FurlPayRouter

**Reviewed 2026-09-25.** Scope: `packages/contracts/contracts/FurlPayRouter.sol`
and the off-chain Arc settlement path in `apps/web/src/lib/`.

**This is not an audit.** It is an adversarial review by the authors of the code.
It found four real defects, which is itself the argument for a third-party audit
rather than against one: a first serious pass over 151 lines produced four
findings, and the base rate for "the next pass finds nothing" is not good.

## Scope, and why it is narrow

Only `FurlPayRouter` is reviewed, because it is the only contract proposed for
deployment — see
[`ARC-DEPLOYMENT-ARCHITECTURE.md`](./ARC-DEPLOYMENT-ARCHITECTURE.md). The other
12 contracts are **not reviewed** and must not be deployed on the strength of
this document. Saying so explicitly matters: a review that covers one contract in
a directory of thirteen is routinely cited later as having covered the directory.

## Method

1. Read the contract against Arc's documented differences, rather than against a
   generic EVM.
2. For each suspected defect, **write a test that proves it on the current code
   before changing anything.** Two exploits were confirmed passing against the
   pre-fix contract.
3. Fix the class, not the instance — then keep the exploit as a regression test
   with the attacker given every remaining advantage.
4. Record what was checked and found clean, so a later reader knows the
   difference between "sound" and "not looked at".

Step 2 is the part that matters. A finding written up without a failing test is a
hypothesis, and this file would otherwise be a list of things that might be true.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| R1 | **High (availability)** | Global nonce namespace → anyone can permanently destroy any observable authorization for gas alone | **Fixed** |
| R2 | Low | `batchPay` documented a 100-item bound and enforced none | **Fixed** |
| R3 | Low | Zero-amount payments emitted a settlement event for a non-settlement | **Fixed** |
| R4 | Medium | Unbounded `deadline` — an authorization could stay executable indefinitely | **Fixed** |
| R5 | Medium (availability) | One blocklisted party reverts an entire `batchPay` on Arc | **Accepted, mitigated off-chain** |
| R6 | Medium (availability) | A blocklisted `feeTreasury` is a total outage of the fee-bearing path | **Accepted, needs monitoring** |
| R7 | **High (correctness)** | Arc fee floor unguarded on the submission path → payments hang forever with no signal | **Open** |
| R8 | **High (correctness)** | `settlementProof` cannot verify a native Arc payment, and the obvious fix introduces a 10¹² under-accept | **Open** |

R7 and R8 are open and are **blockers for Arc settlement**, not for deployment of
the contract. They are off-chain.

---

### R1 — A nonce was a shared resource (High, availability) — FIXED

`usedNonces` was `mapping(bytes32 => bool)`: one global namespace for all payers.

**The attack, confirmed passing against the pre-fix contract:**

1. The attacker reads a pending authorization's nonce. It is in the relayer's
   calldata, so watching the mempool suffices — no privileged position needed.
2. The attacker signs *their own* authorization reusing that nonce, with
   `amount = 0`, `fee = 0`.
3. Every check passed. The fee ceiling is `fee * 10_000 > amount * MAX_FEE_BPS`,
   and `0 > 0` is false. A zero-value `transferFrom` requires neither balance nor
   allowance, so the transfer succeeded.
4. The nonce was marked used. The victim's funded 150 USDC authorization then
   reverted `NonceAlreadyUsed` — permanently. It must be re-signed, and the new
   one can be killed the same way.

**Cost to the attacker: gas.** Zero USDC, zero allowance, no relationship to the
victim.

No funds are stealable, so this is availability rather than theft. But it is an
unauthenticated, indefinitely repeatable denial of the entire payment rail, and
it cannot be mitigated off-chain, because the attacker's transaction is perfectly
valid — there is nothing to detect and nothing to reject.

**Fix:** `mapping(address payer => mapping(bytes32 => bool))`. A nonce is now
only consumable by the address that signed it, so the class is gone rather than
the cheapest route to it.

Two notes on the fix:

- The `ZeroAmount` guard (R3) independently closes the *free* version of this
  attack. It is not the fix. An attacker willing to make a 1-unit payment could
  still grief. The regression test therefore gives the attacker real USDC, a real
  allowance and a non-zero amount, so it proves the **namespace** is what stops
  them.
- It fixes a bug in the other direction too. Nonces are client-chosen, so two
  payers independently generating the same nonce previously broke one of them for
  no reason. Now tested as a legitimate case.

### R2 — A bound that existed only in prose (Low) — FIXED

`batchPay`'s docstring said "up to 100 authorizations". The loop was unbounded.
**Confirmed: 150 went through.**

Not a fund-safety bug — an oversized batch exhausts block gas and reverts, which
is self-inflicted. It is included because it was a false statement in a contract
heading into an audit, and this is precisely the kind of claim that gets repeated
into a security review as though the code enforced it.

**Fix:** `MAX_BATCH = 100`, checked. Tests cover 101 (rejected) and 100
(accepted), so the bound cannot be off by one.

### R3 — A settlement event for a non-settlement (Low) — FIXED

`amount == 0` passed every check, consumed a nonce, and emitted
`PaymentExecuted`. Any downstream indexer would faithfully record a settlement
that moved nothing.

**Fix:** `ZeroAmount`.

### R4 — Authorizations valid indefinitely (Medium) — FIXED

`deadline` had no upper bound, so a deadline in the year 3000 was as valid as one
15 minutes out.

A signed authorization plus a standing USDC allowance is a **bearer instrument**:
anyone who ever observed it can execute it until it expires. An unbounded
deadline means "forever", and a stale authorization could settle long after the
payer had forgotten it existed.

**Fix:** `MAX_DEADLINE_WINDOW = 24 hours`. Deliberately generous — the API issues
900-second quotes (`EXPIRY_SECONDS`, `lib/services/payments.ts`) — so the bound
cannot reject a legitimate quote. Tested at both ends.

### R5 — One blocklisted party fails a whole batch (Medium, availability) — ACCEPTED

On Arc, a transfer to *or from* a blocklisted address **reverts**. `batchPay` is
one transaction, so a single blocklisted recipient in a 100-payment payroll run
reverts all 100.

**Not fixed on-chain, deliberately.** A per-item try/catch would change
`batchPay` from atomic to partial, which is a product decision about payroll
semantics — not a security fix to be made unilaterally in a review.

**Mitigation:** screen every party with `assertArcPartiesClear`
(`lib/chains/arcCompliance.ts`) **before** building the batch. This is cheap: the
screening call is a free `eth_call` against USDC itself.

**Residual risk:** an address blocklisted between screening and inclusion. Arc
finalises on inclusion and blocks are sub-second, so the window is small, but it
is not zero and cannot be closed from outside the chain.

### R6 — A blocklisted fee treasury is a total outage (Medium, availability) — ACCEPTED

If `feeTreasury` is blocklisted, **every `fee > 0` payment reverts.** The rail
stops entirely.

Recoverable: `setFeeTreasury` (owner) and `pause()` both exist. But only if it is
*detected* — and it would present as "all payments suddenly failing", which is
indistinguishable at a glance from an RPC problem.

**Requirement this places on operations:** the treasury address must be in the
monitored screening set, not just counterparties. A screening check that only ever
runs against customers will not see this.

### R7 — The fee floor is unguarded on the submission path (High, correctness) — OPEN

Arc's minimum base fee is 20 Gwei, and a transaction below it is **silently
dropped with no error receipt**. `lib/chains/evmAdapter.ts` falls back to 1 Gwei
when `eth_gasPrice` is unavailable — 20× too low.

Why this is High rather than an operational annoyance: **there is no signal.** Not
a revert, not a failed status, not an error. Absence of a receipt is exactly what
a pending transaction looks like, so every receipt-polling loop reads it as "not
mined yet" and waits. A user's settlement would hang indefinitely while the system
reported progress, and no reconciliation pass can detect it because there is
nothing to reconcile against.

`assertArcFeeFloor` exists in `lib/chains/arc.ts` with tests, including one
pinning that exact 1 Gwei default. **It is not wired into the relayer path.**

**Required before any Arc submission:** call it on the build path. Not after — by
then the only evidence is gone.

### R8 — Settlement proof cannot verify a native Arc payment (High, correctness) — OPEN

`lib/travel/settlementProof.ts` requires a Transfer log's emitter to equal the
USDC contract address. On Arc that is wrong in both directions.

**Measured on Arc mainnet 2026-09-25:**

```
tx 0xbb74a675…cec9   a plain native send
  system emitter (0xffff…fffe)  10639294662379335864   (18dp)
  USDC ERC-20     (0x3600…0000)  no log at all
```

A plain native send — which on a chain where USDC *is* the gas token is the
**ordinary way to pay** — emits no log from the USDC contract, so it currently
proves nothing. It fails closed, which is the right direction, but by accident
rather than by decision.

**The trap in fixing it.** The verifier compares `value >= expectedValue` where
`expectedValue` is 6dp atomic USDC. Adding the system emitter to the accepted set
without converting scales means comparing an 18dp value against a 6dp
expectation: an expectation of `1000000` (= $1) is satisfied by `1000000` wei,
which is **$0.000000000001**. A 10¹² under-accept, and nothing about
`value >= expected` looks wrong — both sides are plain `bigint`s.

So the accident currently protecting us is load-bearing, and the obvious fix
removes the protection while introducing the severe bug.

**Required fix:** route through `arcCreditableTransfers` /
`arcLogValueToNative` (`lib/chains/arc.ts`), which normalise to a stated scale
and de-duplicate the two streams. Tests in `arcDualEmitter.spec.ts` use the two
real mainnet transactions above as fixtures and assert the naive comparison is
unreachable.

---

## Checked and found clean

Recorded so a later reader can distinguish "sound" from "not examined".

| Concern | Finding |
|---|---|
| **Signature malleability** | Clean. OpenZeppelin 5.x `ECDSA.recover` rejects `s > n/2` and non-canonical `v`, so a malleated signature cannot produce a second valid authorization. |
| **Cross-chain replay** | Clean, and structurally so. OZ `EIP712` includes `chainId` **and** `verifyingContract` in the domain separator and recomputes when `block.chainid` changes. An Arbitrum authorization cannot execute on Arc even at an identical address. |
| **EIP-712 encoding** | Correct. Typehash field order matches the struct; `paymentId` is hashed as `keccak256(bytes(...))` per the spec for dynamic types. |
| **API/contract typed-data agreement** | Verified field-by-field against `lib/services/payments.ts`. A mismatch would fail closed (no signature would validate), but it does not mismatch. |
| **Reentrancy** | Clean twice over: `nonReentrant` on both entry points, and the nonce is written **before** the token call (checks-effects-interactions). |
| **Arithmetic** | No unchecked blocks. `amount - fee` cannot underflow because the fee ceiling caps `fee` at 1% of `amount`. `fee * 10_000` overflow reverts under 0.8 checked arithmetic. |
| **Fee manipulation** | Clean. `fee` is inside the signed payload, so a relayer cannot alter it; the contract additionally caps it at 1% regardless of what the API quoted. |
| **Stuck funds** | None possible. The contract never holds USDC — `transferFrom` moves payer → recipient directly. No rescue function is needed, and correctly none exists. |
| **`payer` parameter** | Redundant but safe: it is checked against the recovered signer, not trusted. |
| **Access control** | `Ownable2Step` (two-step transfer), `pause`/`unpause`/`setFeeTreasury` owner-only, `pay`/`batchPay` deliberately permissionless — funds only move from a signer, so an arbitrary caller cannot redirect value. |
| **`PREVRANDAO`** | Not used. Arc always returns 0. |
| **Block timestamps** | Used only for a `>` comparison. Arc's 1-second granularity and possible shared timestamps across sub-second blocks are not a problem for that. |
| **solc `evmVersion: "cancun"`** | Safe. Arc's baseline is Osaka, a superset. |
| **Upgradeability** | No proxy, deliberately. An upgradeable router is an upgradeable path to every user's USDC allowance; `Pausable` + redeploy + repoint `FURLPAY_ROUTER_ADDRESS` is a smaller surface than an upgrade key. |

## Deployment conditions

Ordered. Each is a check, not a judgement.

1. **R7 fixed and wired** — `assertArcFeeFloor` called on the Arc submission path,
   with a test proving a 1 Gwei fee is refused. *Blocker.*
2. **R8 fixed** — settlement proof routed through `arcCreditableTransfers`, with a
   test proving the 10¹² under-accept is unreachable. *Blocker for settlement.*
3. **R5/R6 mitigation live** — `assertArcPartiesClear` on both parties before a
   batch, **and the fee treasury in the monitored set.**
4. **Owner ≠ deployer.** The deployer key sends one transaction; the owner key can
   redirect every fee and pause the rail.
5. **Testnet first**, including a deliberate blocklist revert against Arc's
   published `0x70997970…79C8` — the only way to exercise that path without a
   real sanctioned party.
6. **Third-party audit before mainnet.** This review found four defects in 151
   lines; that is the evidence for an audit, not against it.

## Open questions this review could not resolve

- **Gas cost on Arc.** Unmeasurable before a testnet deploy. Gas is USDC, so
  "cost" here is denominated in dollars and belongs in the runbook.
- **Whether Arc's validator-layer screening is observable to a submitter** other
  than as a revert. If it is not, R5's residual window cannot be narrowed.
- **Whether source verification is available** on Arc's explorer for a
  non-permissioned party. `etherscan.apiKey` is left unset rather than pointed at
  a guessed URL.
- **Testnet/mainnet behavioural parity.** Assumed, unverified. Every measurement
  in this review was taken on mainnet.
