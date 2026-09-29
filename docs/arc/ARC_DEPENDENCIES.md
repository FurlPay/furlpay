# Arc + Circle: what was verified, and from where

Verified 2026-09-28 against current published documentation, **not** against
constants already in this repository. Where a repository constant and a source
disagreed, the source wins and the disagreement is recorded.

Every row below is either CONFIRMED (found in Circle/Arc's own material) or
UNVERIFIED (found only in secondary material, or contradicted between sources).
Nothing is marked confirmed because it seemed reasonable.

---

## 1. Network constants

| Fact | Value | Status | Source |
|---|---|---|---|
| Arc mainnet chain ID | `5042` (`0x13b2`) | CONFIRMED | Arc mainnet launch material; matches repo constant |
| Arc testnet chain ID | `5042002` (`0x4cef52`) | CONFIRMED | Arc docs; matches repo constant |
| Arc testnet RPC | `https://rpc.testnet.arc.io` | CONFIRMED | Arc docs |
| Arc testnet explorer | `https://explorer.testnet.arc.io` | CONFIRMED | Arc docs |
| Arc mainnet RPC | `https://rpc.mainnet.arc.io` | UNVERIFIED | Repo constant. Not independently re-confirmed this session. **Must be checked before any mainnet use.** |
| Block time | ~0.5 s, instant finality claimed | UNVERIFIED | Secondary reporting only. See §4 — we do NOT encode this. |
| Validators | Circle + 11 institutions (BlackRock, DTCC, ICE, Mastercard, Visa, …) | CONFIRMED | Arc launch material |

The repository's existing chain IDs and testnet endpoints were **correct**. No
change was required.

---

## 2. The decimal trap — the single most important fact on this page

Arc's gas token *is* USDC, and USDC is exposed through **two interfaces with
different decimal counts**:

| Interface | Decimals | Used by |
|---|---|---|
| **Native** | **18** | `gasPrice`, `value`, `eth_getBalance`, receipts, `msg.value` |
| **ERC-20** | **6** | `balanceOf`, `transfer`, `transferFrom`, approvals, allowances |

Conversion factor: **10^12**.

> A value handled through the wrong interface is wrong by a factor of a
> trillion, **and produces no error**. Circle's own guidance to wallets is to
> divide the 18-decimal figure by 10^12 for display.

This is not a hypothetical. There are open issues against `circlefin/arc-node`
for exactly this — one titled *"USDC decimal ambiguity: 18 decimals as native
gas token vs 6 decimals as ERC-20 — undocumented, causes silent value bugs"*
(#91), and another reporting that Circle's **own documentation example sends
1e-12 USDC instead of 1 USDC** (#453).

**Repository status: already handled correctly.** `apps/web/src/lib/chains/arc.ts`
defines `ARC_NATIVE_DECIMALS = 18`, `ARC_ERC20_DECIMALS = 6`,
`ARC_DECIMAL_SCALE = 10n ** 12n`, and a `ArcPrecisionError` thrown by
`assertErc20Scale()` when a native amount is not exactly representable in ERC-20
units. 92 tests cover it. No change was required.

### The dual Transfer log

A **single ERC-20 USDC transfer on Arc emits two `Transfer` logs**: one from the
system emitter in 18-decimal native units, and one from the ERC-20 contract in
6-decimal units. A reconciler that counts both **double-counts every payment**.

**Repository status: already handled.** `arc.ts` exports `ARC_SYSTEM_EMITTER`
(`0xffff…fffe`) and `ARC_TRANSFER_TOPIC` so the two can be told apart;
`arcDualEmitter.spec.ts` covers it.

---

## 3. CCTP on Arc

| Fact | Value | Status |
|---|---|---|
| Arc CCTP domain | **26** | CONFIRMED (Arc CCTP V2 integration docs) |
| CCTP version on Arc | **V2 only** | CONFIRMED |
| **V1 selectors** | **INCOMPATIBLE on Arc** | CONFIRMED — `circlefin/arc-node` #110 |
| `minFinalityThreshold` | `1000` (fast) or `2000` (standard); nothing else exists | CONFIRMED — values <1000 are treated as 1000, >1000 as 2000 |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | **TESTNET, UNVERIFIED for mainnet** |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | **TESTNET, UNVERIFIED for mainnet** |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | **TESTNET, UNVERIFIED for mainnet** |
| MessageV2 | `0xbaC0179bB358A8936169a63408C8481D582390C4` | **TESTNET, UNVERIFIED for mainnet** |

⚠️ **These four addresses were found in Arc CCTP integration material describing
Arc TESTNET.** They are recorded here as research, and are deliberately **not**
committed to a mainnet configuration constant. Circle states CCTP contract
addresses are deterministic per chain, which makes it *likely* they are the same
on mainnet — "likely" is not a basis for routing money. Re-read them from
Circle's official CCTP address reference before any mainnet configuration.

**Repository status:** `lib/services/cctpExecution.ts` already calls Circle's
real Iris API (`https://iris-api.circle.com`) with attestation polling and
burn-before-attestation ordering. It must be re-audited against **V2** selectors
specifically, because V1 selectors do not work on Arc.

---

## 4. Finality — deliberately NOT encoded from marketing claims

Secondary sources describe Arc as having "instant finality" with ~506 ms blocks.
**No Arc finality constant is being set from that.** §19 of the implementation
brief is explicit that finality assumptions must not be encoded without
verifying current network guarantees, and a settlement system that treats
"instant" as a configuration value inherits every future change to that claim.

Arc confirmation policy therefore stays **configurable, with a conservative
default**, and the number is an operational decision to be made against Circle's
own finality documentation before mainnet — not a constant inherited from a
launch blog.

---

## 5. Circle product support — ON ARC SPECIFICALLY

§14 of the brief is explicit: do not infer Arc support from general availability.

| Product | On Arc | Status | Evidence |
|---|---|---|---|
| **USDC** | Yes — it is the native gas token | CONFIRMED | Arc's defining property |
| **CCTP V2** | Yes, domain 26 | CONFIRMED | Arc CCTP V2 integration docs |
| **Gateway** | Yes | CONFIRMED | Circle's *Gateway supported blockchains* reference lists Arc |
| **Circle Wallets** | Claimed | UNVERIFIED | Only on a general Arc overview page |
| **Circle Mint** | Claimed | UNVERIFIED | Only on a general Arc overview page |
| **Circle Paymaster** | **NOT CONFIRMED** | **CONTRADICTED** | See below |

### Paymaster: the sources disagree, and the architecture settles it

Circle's own Paymaster expansion announcement lists its supported chains as
**Arbitrum, Base, Ethereum, OP Mainnet and Polygon PoS**, with Avalanche and
Unichain "coming soon". **Arc is not in that list.** A separate general Arc
overview page claims Arc has "full Circle platform integration with … Paymaster".

Rather than pick a side, note what Paymaster is *for*: it lets a user pay gas in
USDC on a chain whose gas is **not** USDC. **On Arc, gas is already USDC.**

So Circle Paymaster is **architecturally redundant on Arc**, and FurlPay gains
nothing by integrating it there. This is recorded as
`UNSUPPORTED_OR_UNNECESSARY_ON_ARC` rather than as a gap, and no integration is
built. If Circle later documents a specific Arc Paymaster use case (sponsoring
gas for a user holding no USDC at all), revisit it then.

---

## 6. What this changes in the repository

Nothing in §1–§2 required a code change: the existing Arc constants, decimal
handling and dual-emitter logic were already correct and already tested. That
is worth stating plainly, because the value of this verification pass is
partly that it found the existing work to be sound.

What it *did* establish:

1. CCTP work on Arc must target **V2 selectors only** — V1 is incompatible.
2. CCTP mainnet addresses must be re-read from Circle's official reference; the
   ones found this session describe testnet.
3. Paymaster should not be built for Arc.
4. Arc finality must stay configurable, not constant.
5. The Arc mainnet RPC constant in the repo is **not independently verified**.

---

## Sources consulted

- Arc docs — stablecoin-native model, network reference
- arc.io engineering blog — *USDC for Every Action*, *Two Interfaces for One Token*, *Compatibility Guide for Existing EVM Apps*
- `circlefin/arc-node` issues #91, #110, #453 — decimal ambiguity, CCTP V2 on Arc, docs decimal error
- Circle Docs — CCTP technical guide; Gateway supported blockchains
- Circle blog — Paymaster expansion (supported-chain list)
- Arc mainnet launch coverage (chain ID, validators) — secondary, used only for non-load-bearing facts
