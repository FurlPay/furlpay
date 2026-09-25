# Arc mainnet readiness checklist

**As of 2026-09-25.** This file is referenced by
`packages/contracts/scripts/deploy-arc.ts`, which refuses to deploy to chain 5042
unless `ARC_MAINNET_DEPLOY_CONFIRMED=yes` is set.

**Do not set that variable while any box below is unchecked.** The instruction
governing this work is explicit: if any item is unchecked, do not deploy to
mainnet. The gate is only as good as the honesty of this list.

## Current verdict: NOT READY

Two independent hard blockers, neither of which is a coding task:

1. **No third-party audit exists.** An authors' review of 151 lines found four
   real defects (one High). That is evidence *for* an audit, not a substitute.
2. **No funded Arc deployer key exists.** Nothing can be deployed to testnet,
   so nothing can be exercised before mainnet.

Everything that *can* be done without credentials has been done. What remains
needs a decision, a signature, or money.

---

## A. Contract correctness

- [x] Minimum surface decided — **one contract** (`FurlPayRouter`). 12 others
      explicitly excluded, each with a reason
      ([`ARC-DEPLOYMENT-ARCHITECTURE.md`](./ARC-DEPLOYMENT-ARCHITECTURE.md)).
- [x] R1 fixed — per-payer nonce namespace. Cross-payer griefing was
      **demonstrated** against the pre-fix contract, then re-asserted as a
      regression test with the attacker given funds, allowance and a non-zero
      amount so the namespace is provably what stops them.
- [x] R2 fixed — `MAX_BATCH = 100` enforced, not merely documented. Tested at
      101 (rejected) and 100 (accepted).
- [x] R3 fixed — zero-amount payments refused.
- [x] R4 fixed — `MAX_DEADLINE_WINDOW = 24h`, generous against the API's own
      900-second quotes.
- [x] Contract test suite green — 64 passing, 2 pending (fork tests need an
      archive RPC).
- [x] Cross-chain replay confirmed impossible (EIP-712 binds `chainId` **and**
      `verifyingContract`; OZ recomputes on `block.chainid` change).
- [ ] **Third-party audit — BLOCKER.** OpenZeppelin / Spearbit / Trail of Bits /
      CertiK. Not started, not scheduled, not scoped.
- [x] Deployment cost measured on Arc — **≈ 0.034 USDC** at 45 Gwei
      (`33,888,248,437,500,000` wei), obtained by running the deploy script
      against live Arc testnet up to the broadcast. Gas is USDC, so that figure
      is already dollars. Bytecode size still unrecorded.

## B. Off-chain settlement path

- [x] Arc facts verified on-chain, not read from docs — chain IDs (mainnet
      `0x13b2`, testnet `0x4cef52`), USDC `decimals()`/`symbol()`, CCTP domain 26
      cross-confirmed by three contracts, non-zero burn limit.
- [x] Decimal layer — `USDC.arc` modelled as ONE asset at canonical 18dp;
      `toErc20Units` truncates rather than rounds.
- [x] R7 guard **written** — `assertArcFeeFloor`, build-path assert, refuses
      rather than clamps.
- [ ] **R7 guard WIRED into the relayer submission path.** *Blocker for any Arc
      submission.* The guard exists and is tested; nothing calls it. An
      underpriced Arc transaction is dropped with **no receipt**, so it hangs
      indistinguishably from pending and no retry or reconciliation can detect
      it. `lib/chains/evmAdapter.ts` still falls back to 1 Gwei — 20× too low.
- [x] R8 fixed — `settlementProof.ts` routes Arc through `arcCreditableTransfers`
      and compares 6dp against 6dp, so the 10¹² under-accept is unreachable. Arc
      branch now also gates on its stated confirmation requirement.
- [x] Dual-emitter de-duplication — `arcCreditableTransfers`, with the two real
      mainnet transactions as test fixtures.
- [x] Payload verifier Arc-aware — native and ERC-20 paths both correct; the
      previous state (all Arc ERC-20 refused, native passing only because a
      registry entry was missing) verified by test before changing it.
- [x] Mobile signing description Arc-aware, both interfaces, both scalings.
- [x] `receipt.status` checked on the Arc path; `classifyArcTransferFailure`
      exists and never retries a blocklist revert.
- [x] `USDC.arc` added to `lib/assets/stablecoins.ts` with a verified
      `addressSource` and `verifiedAt`, resolving the inconsistency that made the
      old native-path behaviour accidental. Adding it would have **broken every
      native Arc payment** on the pre-fix verifier; a test now pins that the
      entry exists AND that native transfers still pass, so the two cannot drift
      apart again.
- [ ] Deposit indexing path confirmed not to sum both Transfer streams. The
      helper exists; the indexer has not been audited against it.

## C. Compliance

- [x] Decision made and justified —
      [`ARC-COMPLIANCE-DECISION.md`](./ARC-COMPLIANCE-DECISION.md). Screen
      against Circle's USDC `isBlacklisted`, which is the contract that
      *enforces*, rather than a mirrored registry or a vendor list that can
      diverge from it.
- [x] Verified on both networks against Arc's published test-blocklisted
      address: TRUE on testnet, false on mainnet.
- [x] Fail-closed by construction — three states, every failure path yields
      `unknown`, `unknown` refuses, and a test sweeps all five paths to prove
      none can return `clear`.
- [x] Both parties screened (Arc reverts to *or from* a blocklisted address).
- [ ] **`assertArcPartiesClear` wired into the Arc settlement path.** Same gap as
      R7: the guard exists, nothing calls it. The decision is not in force until
      it does.
- [ ] Fee treasury in the monitored screening set (finding R6 — a blocklisted
      treasury is a total outage that presents as "all payments failing").
- [ ] Blocklist revert exercised in a **real transfer** on testnet. Verified so
      far only as a view call.
- [ ] Scope limits acknowledged by whoever owns compliance: this is not AML, not
      KYC, not transaction monitoring, and covers USDC only — not EURC, USYC or
      cirBTC on Arc.

## D. Keys and operations

- [x] Hardhat uses a **separate** `accounts` entry for `arcMainnet`, so a
      testnet command run with the wrong `--network` cannot sign with a
      production key.
- [x] Deploy script refuses: wrong chain; mainnet without explicit
      confirmation; owner equal to deployer; missing owner/treasury; USDC whose
      `decimals()` ≠ 6 or `symbol()` ≠ USDC; any blocklisted participant; a
      balance that cannot cover the estimated cost; a fee below the 20 Gwei
      floor. It re-reads `usdc`/`owner`/`feeTreasury` from the chain afterwards
      and records the deployment to `deployments/arc-<chainId>.json` with
      `audited: false`.
- [x] **Gates verified against live Arc testnet**, not just reasoned about. Each
      was made to fire: wrong chain (31337); mainnet without confirmation;
      missing signer; missing owner/treasury; and — the important one — the
      blocklist screen **refused Arc's real published blocklisted address after
      querying Circle's live USDC contract**. A dusty key was also correctly
      refused for insufficient funds before broadcast rather than failing with a
      raw node error. USDC read back live as `decimals=6 symbol=USDC`.
- [ ] Owner address chosen, custodied, and **not** the deployer EOA. A multisig
      (Safe) is the right answer for mainnet; the script enforces only that the
      two differ.
- [ ] Fee treasury address chosen and screened.
- [ ] **Deployer funded with USDC on Arc — BLOCKER.** Gas is USDC. A key funded
      with ETH has nothing to pay with and every transaction fails at estimation.
      Testnet faucet: `https://faucet.circle.com`.
- [ ] Source verification route established. Arc's explorer is documented as
      requiring permissioned access, so `etherscan.apiKey` is intentionally unset
      rather than pointed at a guessed `customChains` URL.
- [ ] Incident runbook: who can `pause()`, how quickly, and from where.

## E. Testnet first — every item needs a funded key

- [ ] `FurlPayRouter` deployed to **5042002**; address, tx hash and block
      recorded in `docs/deployments/arc-testnet.md`.
- [ ] A real `pay()` succeeds end to end.
- [ ] A real `batchPay()` succeeds.
- [ ] A payment involving `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` **reverts**
      — Arc's published blocklisted test address, and the only way to exercise
      that path without a real sanctioned party.
- [ ] `receipt.status` correctly read as failure on that revert, and
      `classifyArcTransferFailure` returns `blocklisted`.
- [ ] A deliberately underpriced transaction confirms the fee-floor behaviour —
      **and confirms it produces no receipt**, which is the claim the whole R7
      design rests on and which we have taken from the docs rather than observed.
- [ ] Testnet/mainnet behavioural parity spot-checked. Every measurement in this
      work was taken on mainnet; testnet parity is assumed.

## F. Mainnet

Only after **every** box above.

- [ ] Audit findings all resolved or explicitly accepted in writing.
- [ ] `ARC_ROUTER_OWNER` / `ARC_FEE_TREASURY` set to custodied addresses.
- [ ] Deployer funded with USDC on Arc mainnet.
- [ ] `ARC_MAINNET_DEPLOY_CONFIRMED=yes` — the last thing set, not the first.
- [ ] Deployed; address recorded in `docs/deployments/arc-mainnet.md`.
- [ ] `FURLPAY_ROUTER_ADDRESS` set in production env. Until then
      `lib/services/payments.ts` fails closed, by design.
- [ ] Feature flags stay **off** until a real payment has been verified on
      mainnet with a small amount.
- [ ] `docs/VERIFIED-CLAIMS.md` updated. It was last verified 2026-09-13 and is
      now 12 days stale.

---

## What must not be said before the boxes are ticked

Recorded because these are the exact sentences that get written prematurely:

- ❌ "FurlPay is live on Arc." One router is not travel escrow, x402 settlement,
  booking receipts, or CCTP flows — none of which has a deployed counterpart.
- ❌ "Our contracts are audited." No audit has been performed.
- ❌ "Arc settlement is enabled." Two guards (R7, screening) exist but are wired
  into nothing.
- ❌ "Sanctions screening is live on Arc." The decision is made and the code is
  tested; it is not on a settlement path.
- ❌ Quoting a testnet address as a mainnet deployment.

## The honest one-line status

*Arc integration is code-complete and tested at the library level, reviewed by its
authors, and deployed nowhere. The next step is a funded testnet key, not more
code.*
