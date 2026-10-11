# Arc + Circle: what was verified, and from where

Verified 2026-09-28 against current published documentation, **not** against
constants already in this repository. Where a repository constant and a source
disagreed, the source wins and the disagreement is recorded.

Every row below is either CONFIRMED (found in Circle/Arc's own material) or
UNVERIFIED (found only in secondary material, or contradicted between sources).
Nothing is marked confirmed because it seemed reasonable.

**Re-verified 2026-10-09 (ARC-P6-001)** by read-only JSON-RPC against
`rpc.mainnet.arc.io` and `rpc.testnet.arc.io` and by first-party docs. Rows
changed by that pass say so; the evidence is in
`docs/ARC_NETWORK_INTEGRATION_AUDIT.md` → *Remediation, 2026-10-09*.

---

## 1. Network constants

| Fact | Value | Status | Source |
|---|---|---|---|
| Arc mainnet chain ID | `5042` (`0x13b2`) | CONFIRMED | Arc mainnet launch material; matches repo constant |
| Arc testnet chain ID | `5042002` (`0x4cef52`) | CONFIRMED | Arc docs; matches repo constant |
| Arc testnet RPC | `https://rpc.testnet.arc.io` | CONFIRMED | Arc docs |
| Arc testnet explorer | `https://explorer.testnet.arc.io` | CONFIRMED | Arc docs |
| Arc mainnet RPC | `https://rpc.mainnet.arc.io` | **CONFIRMED 2026-10-09** | Live: `eth_chainId` = `0x13b2`; head block 25,025,629 with a timestamp within 2 s of wall clock; `baseFeePerGas` = 20 gwei (the documented floor) |
| Finality | Deterministic, single block | **CONFIRMED 2026-10-09** | docs.arc.io/arc-chain: "Transactions are final in under 1 second. No need to wait for multiple block confirmations." and "no risk of chain reorganization". See §4 |
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

### …and the native-only send (corrected 2026-10-09)

The converse is the expensive case: a **native** USDC send (`value` > 0, no
contract call) emits **only** the system-emitter log. Measured on Arc mainnet
over blocks 25,025,428–25,025,728: 1,260 system-emitter Transfer logs, 477
ERC-20 Transfer logs — every ERC-20 log paired with a system log at exactly
10¹², and **783 movements (62%) native-only**. A collector reading only the
ERC-20 contract would miss them; the merchant verifier, reconciliation and
refund reader now read the system emitter (`e82e7f0f`, ARC-P1-001/P2-003).

---

## 3. CCTP on Arc

| Fact | Value | Status |
|---|---|---|
| Arc CCTP domain | **26** | CONFIRMED (Arc CCTP V2 integration docs) |
| CCTP version on Arc | **V2 only** | CONFIRMED |
| **V1 selectors** | **INCOMPATIBLE on Arc** | CONFIRMED — `circlefin/arc-node` #110 |
| `minFinalityThreshold` | `1000` (fast) or `2000` (standard); nothing else exists | CONFIRMED — values <1000 are treated as 1000, >1000 as 2000 |
| TokenMessengerV2 — **testnet** | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | **CONFIRMED 2026-10-09**: 2,175 bytes of code on Arc testnet; **no code on mainnet** |
| MessageTransmitterV2 — **testnet** | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | **CONFIRMED 2026-10-09**: code on testnet, `localDomain()` = 26; **no code on mainnet** |
| TokenMinterV2 / MessageV2 — testnet | `0xb43d…F192` / `0xbaC0…90C4` | Recorded only; **no code on mainnet**; not used by the repo |
| TokenMessengerV2 — **mainnet** | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | **CONFIRMED 2026-10-09**: 2,175 bytes of code on Arc mainnet; no code on testnet |
| MessageTransmitterV2 — **mainnet** | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | **CONFIRMED 2026-10-09**: code on mainnet, `localDomain()` = **26** |

**Resolved 2026-10-09.** The earlier warning was right to refuse "likely": the
testnet addresses are **not** deployed on mainnet. Mainnet uses Circle's
standard CCTP V2 addresses (`0x28b5…`/`0x81D4…`), which is exactly what
`lib/services/cctpExecution.ts` (MAINNET_* vs TESTNET_* constants) and
`lib/onchain/cctp.ts` already use. Verified with `eth_getCode` on both networks
and `localDomain()` returning `0x1a`. Burn amounts are now exact (`412f6f99`,
ARC-P6-002). An end-to-end burn → attestation → mint has **not** been executed
(ARC-P2-002, needs testnet funds).

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

**Update 2026-10-09 (ARC-Pn-003, verified).** That first-party documentation now
exists: docs.arc.io/arc-chain states transactions are final in under a second,
with no need to wait for multiple confirmations and no reorganisation risk. The
merchant deposit policy (`lib/chains/depositConfirmation.ts`) is 1 confirmation
with `boundedFinality: true` for `arc` and `arc-testnet`, and the verifier still
re-reads the receipt and checks the block hash is canonical before crediting.

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
| **Circle Compliance (screen-address)** | **No** | **CONFIRMED 2026-10-09** (ARC-Pn-001) | The `chain` enum of developers.circle.com/api-reference/wallets/compliance/screen-address has no ARC entry. Arc addresses are therefore screened against Arc's own USDC blocklist (`isBlacklisted`, `0xfe575a87`) plus OFAC, fail-closed (`f8f756ad`, ARC-P2-004) |

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
5. ~~The Arc mainnet RPC constant in the repo is not independently verified.~~
   Verified live 2026-10-09 (chain id 5042, fresh head).
6. (2026-10-09) CCTP mainnet addresses verified on-chain; testnet addresses
   are testnet-only. Finality verified first-party. Circle Compliance does not
   cover Arc.

---

## Sources consulted

- Arc docs — stablecoin-native model, network reference
- arc.io engineering blog — *USDC for Every Action*, *Two Interfaces for One Token*, *Compatibility Guide for Existing EVM Apps*
- `circlefin/arc-node` issues #91, #110, #453 — decimal ambiguity, CCTP V2 on Arc, docs decimal error
- Circle Docs — CCTP technical guide; Gateway supported blockchains
- Circle blog — Paymaster expansion (supported-chain list)
- Arc mainnet launch coverage (chain ID, validators) — secondary, used only for non-load-bearing facts
