# Arc & Circle — official references, and what we verified ourselves

**Compiled 2026-09-25.** Every claim here is either (a) quoted from an official
Circle or Arc source with the URL, or (b) measured against Arc mainnet from this
machine with the command recorded. Nothing is included because it was plausible.

The distinction is load-bearing and is marked on every row:

| Mark | Means |
|---|---|
| **DOC** | Stated by an official Arc/Circle source. Cited. |
| **MEASURED** | Observed by us against `https://rpc.mainnet.arc.io`. Reproducible. |
| **DOC+MEASURED** | Both, and they agree. The strongest class. |
| **UNVERIFIED** | Reported by a secondary source only. Not relied on. |

## Why this file exists

Two reasons, both learned the hard way in this repo.

1. Pasted research reports about this project have repeatedly cited documents
   that do not exist and root causes that appear nowhere in the code. A
   references file whose every line carries a URL or a command is the cheapest
   defence against building on a fabricated premise.
2. Arc is three weeks old at time of writing. Secondary sources about it are
   already wrong in at least one material way (see "Corrections" below). Primary
   sources only.

## Primary sources

| Source | URL |
|---|---|
| Arc docs — contract addresses | https://docs.arc.io/arc/references/contract-addresses |
| Arc docs — EVM differences | https://docs.arc.io/arc/references/evm-differences |
| Arc — security & network controls | https://www.arc.io/security |
| Arc — EVM app compatibility guide | https://www.arc.io/blog/arc-compatibility-guide-for-existing-evm-apps |
| Arc — wallet integration guide | https://www.arc.io/blog/supporting-arc-in-wallets-one-balance-usdc-fees-and-complete-history |
| Circle — CCTP supported chains & domains | https://developers.circle.com/cctp/concepts/supported-chains-and-domains |
| Circle — Arc public testnet announcement | https://www.circle.com/pressroom/circle-launches-arc-public-testnet |

Note `docs.arc.network` 301-redirects to `docs.arc.io`. Cite the latter.

## 1. Network identity

| Fact | Value | Class |
|---|---|---|
| Mainnet chain ID | `5042` (`0x13b2`) | **DOC+MEASURED** — `eth_chainId` → `0x13b2` |
| Testnet chain ID | `5042002` | **DOC** |
| Devnet chain ID | `5042001` | **DOC** |
| Local dev chain ID | `1337` | **DOC** |
| Mainnet RPC | `https://rpc.mainnet.arc.io` | **DOC+MEASURED** (answers) |
| Testnet RPC | `https://rpc.testnet.arc.io` | **DOC** |
| Mainnet explorer | `https://explorer.arc.io` | **DOC** |
| Testnet faucet | `https://faucet.circle.com` | **DOC** |
| Mainnet live since | 2026-09-16 | **DOC** |
| Consensus | Proof of Authority, permissioned validator set | **DOC** — arc.io/security |
| Finality | Deterministic, on inclusion | **DOC** |

In code: `apps/web/src/lib/chains/arc.ts`.

## 2. USDC on Arc — one balance, two interfaces

This is the single most consequential fact about Arc for a payments system.

> Arc's native token is USDC with two simultaneous interfaces sharing one
> balance: native at **18 decimals**, ERC-20 at **6 decimals**.
> — EVM differences

Circle's guidance, quoted in the compatibility guide, is to
**"present one unified USDC balance rather than separate native and ERC-20
assets"** and to **"convert amounts across the 18-to-6 decimal boundary between
interfaces"**.

| Fact | Value | Class |
|---|---|---|
| USDC ERC-20 interface address | `0x3600000000000000000000000000000000000000` (same on mainnet and testnet) | **DOC+MEASURED** |
| Its `decimals()` | `6` | **MEASURED** |
| Its `symbol()` | `"USDC"` | **MEASURED** |
| Native decimals | `18` | **DOC+MEASURED** |
| Ratio between interfaces | exactly `10^12` | **DOC+MEASURED** |

**MEASURED** — the observation the whole decimal module rests on:

```
account 0x8b1332e6414c830e823110667a6f0c10463d0f98
  eth_getBalance -> 57628035984085784575   (18dp)
  balanceOf      ->           57628035     ( 6dp)
  57628035984085784575 / 10^12 ==  57628035   ✓
```

The ERC-20 view **discarded `984085784575`** of sub-6dp dust. Hence: the native
side is canonical, and conversion truncates rather than rounds — rounding up
would invent money the ERC-20 interface cannot move.

> "never use the 6-decimal value for crediting balances; doing so causes
> truncation losses… A zero `balanceOf` reading doesn't indicate a zero native
> balance."
> — EVM differences

In code: `ARC_NATIVE_DECIMALS`, `ARC_ERC20_DECIMALS`, `toErc20Units`,
`toNativeUnits`, `erc20Remainder`, `assertErc20Scale` in `lib/chains/arc.ts`.
Modelled as ONE asset, `USDC.arc` at 18 decimals, in `lib/money/money.ts`.

## 3. The dual Transfer emitter (EIP-7708)

Arc emits an ERC-20-shaped `Transfer` log for native movements, from a system
address, **at 18 decimals**. So one asset has two log streams at two precisions.

| Fact | Value | Class |
|---|---|---|
| System emitter address | `0xfffffffffffffffffffffffffffffffffffffffe` | **MEASURED** (doc says "a system address"; the address itself we measured) |
| Its value precision | 18 decimals | **DOC+MEASURED** |
| USDC ERC-20 log precision | 6 decimals | **DOC+MEASURED** |
| One `transfer()` emits | BOTH logs | **DOC+MEASURED** |
| A plain native send emits | system log ONLY | **DOC+MEASURED** |

**MEASURED** — `eth_getLogs` over the `Transfer` topic across ~500 blocks ending
at height 22,617,146, 2026-09-25:

```
emitter frequency
  0xffff…fffe   3478 logs      <- more, because it also logs every native leg
  0x3600…0000   2126 logs

tx 0x42d155bab25cd7a8e815152ca2c2e62f570acd44ad633e6fd29a474a37b5c15d
  one transfer(), both logs, same from/to:
    system emitter   91528859000000000000   (18dp)
    USDC ERC-20                91528859    ( 6dp)
    ratio                   1000000000000   == 10^12 exactly

tx 0xbb74a675d7b8243ea5598a7507d3d72add2c770fe84d8b20f7cce2059e9fcec9
  plain native send:
    system emitter   10639294662379335864   (18dp)
    USDC ERC-20      no log at all
```

Circle's own indexing guidance: use the system emitter as the native-movement
stream, convert the 18-decimal value before display, and
**"credit each underlying transfer once."**

**Two opposite failure modes follow, and both are silent:**

- **Double-credit** — summing both streams counts every ERC-20 transfer twice.
- **10¹² under-accept** — comparing a system-emitter value against a 6dp
  expectation passes for a payment a trillion times too small. An expectation of
  `1000000` (= $1 at 6dp) is satisfied by `1000000` wei, i.e. $0.000000000001.
  Both sides are plain `bigint`s and `value >= expected` looks correct.

In code: `ARC_SYSTEM_EMITTER`, `arcLogStream`, `arcLogValueToNative`,
`arcCreditableTransfers` in `lib/chains/arc.ts`; tests in
`lib/__tests__/arcDualEmitter.spec.ts` use the two real transactions above as
fixtures.

## 4. How an Arc transfer fails

Arc applies USDC's transfer rules to plain native sends, because on Arc a native
send *is* a USDC transfer. **DOC** throughout (EVM differences):

| Cause | Behaviour | Observable? |
|---|---|---|
| Value-bearing send to `0x0` | Reverts, `"Zero address not allowed"`. A **zero-value** send to `0x0` succeeds. | Yes — failed receipt |
| To or from a **blocklisted** address | Reverts | Yes — failed receipt |
| Forbidden burn — SELFDESTRUCT to self with a balance, or any non-zero-value call to an already-self-destructed account | Reverts | Yes — failed receipt |
| To a precompile address | Reverts | Yes — failed receipt |
| **`maxFeePerGas` below the 20 Gwei minimum base fee** | **Silently dropped. No error receipt.** | **NO** |

> "An included transaction that reverts on a blocklist check still consumes gas."
> "All reverted transactions consume gas and leave a failed receipt."
> — EVM differences

**So `receipt.status` must be checked on every Arc USDC transfer.** A mined Arc
transfer may have moved nothing.

### The fee floor deserves its own paragraph

It is the only Arc failure mode with **no signal whatsoever**. Not a revert, not
a failed status, not an error from the node — no receipt at all. Absence of a
receipt is exactly what a *pending* transaction looks like, so an underpriced Arc
transaction does not fail; it hangs indistinguishably from congestion until a
human gives up.

The design consequence: it can only be caught **before submission**. Nothing a
retry, timeout or reconciliation pass keys off ever appears.

| Fact | Value | Class |
|---|---|---|
| Minimum base fee | 20 Gwei (of the 18dp native interface) | **DOC** |
| Below it | Silently dropped, no error receipt | **DOC** |
| Next block's base fee | In the parent header's `extra_data` | **DOC** |
| Base fee destination | Paid to block beneficiary, **not burned** | **DOC** |

In code: `ARC_MIN_BASE_FEE_WEI`, `assertArcFeeFloor` (hard assert, build path,
refuses rather than clamps), `assertArcValueTransfer`,
`classifyArcTransferFailure`, `isPermanentArcFailure`.

## 5. EVM behaviour differences that affect contracts

**DOC** throughout (EVM differences). These matter the moment we deploy anything.

| Feature | Arc behaviour | Consequence |
|---|---|---|
| Baseline hard fork | **Osaka**, incl. EIP-7702 | solc `evmVersion` target |
| `PREVRANDAO` | **Always `0`** | **No on-chain randomness.** Anything deriving a value from it is fully predictable. Use a VRF/oracle. |
| Blob txs (EIP-4844) | Rejected by mempool; `BLOBHASH`→0, `BLOBBASEFEE`→1 | Never submit type-3 |
| EIP-4788 beacon roots | Contract omitted; `parentBeaconBlockRoot` = parent execution block hash | Not a randomness source |
| Withdrawals (EIP-4895) | Always empty | — |
| `SELFDESTRUCT` (EIP-6780) | Moves the contract's **native USDC** to the beneficiary | A contract's USDC *is* its native balance |
| Value to a self-destructed account | **Reverts** | **Differs from Ethereum**, where a same-transaction self-destruct target accepts value |
| Block timestamps | Non-decreasing, 1-second granularity; sub-second blocks may **share** a timestamp | Not a unique key |
| Local simulation | `arc-anvil`; stock simulators cannot reproduce Arc rules | **A green test on stock anvil is not evidence about Arc** |

Arc's own compatibility checklist requires eliminating "production logic
depending on `PREVRANDAO` or unique block timestamps".

In code: `ARC_EVM_CONSTRAINTS` in `lib/chains/arc.ts`.

## 6. CCTP V2 on Arc

Addresses below are **DOC** (Arc's published contract-addresses page) and match
`apps/web/src/lib/services/cctpExecution.ts` exactly, on both networks.

| Contract | Mainnet | Testnet |
|---|---|---|
| TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xfd78EE919681417d192449715b2594ab58f5D002` | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| MessageV2 | `0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78` | `0xbaC0179bB358A8936169a63408C8481D582390C4` |
| CrossChainTokenService | `0x431871229103b780868f8C6BB820cd16ECf942BC` | `0x63753E722bd2C2A5DF6EE19C5106662208B81077` |

**Arc CCTP domain: `26`.** **DOC+MEASURED.** Circle's supported-chains page lists
Arc at domain 26. We confirmed against the **live mainnet** contracts, which is
the part that matters:

```
MessageTransmitterV2(0x81D4…4B64).localDomain()        -> 0x1a == 26
TokenMessengerV2(0x28b5…cf5d).localMinter()            -> 0xfd78…D002
    (the TokenMinterV2 address above — the two contracts cross-confirm)
TokenMinterV2(0xfd78…D002).burnLimitsPerMessage(0x3600…0000)
                                                       -> 10_000_000e6  (non-zero)
```

That last line is the difference between "CCTP is configured" and "CCTP works":
a non-zero burn limit means Arc USDC is a **registered burnable local token**.

CCTP decimals on Arc are **6**, like every other chain — CCTP moves through the
ERC-20 interface. The 18dp native side converts at the boundary, and that
conversion is `lib/chains/arc.ts`'s job.

## 7. Other Arc contracts (published, not used by us)

**DOC.** Recorded so nobody re-derives them, and so an address appearing in our
code that is *not* on this list is visible as unaccounted for.

| Contract | Mainnet |
|---|---|
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` |
| USYC Entitlements | `0xb69ecb156Dc0028198028c501340d5367845ca72` |
| USYC Teller | `0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b` |
| cirBTC | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` |
| WETH | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB` |
| GatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| GatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |
| FxEscrow | `0xe2E5F173576B513d994073CCbDaCBE027d43DFe6` |
| Memo | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` |
| Multicall3From | `0x522fAf9A91c41c443c66765030741e4AaCe147D0` |
| CREATE2 Factory (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Arc's testnet also publishes a deliberately **blocklisted address**,
`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, "for testing restricted value
transfer behavior" — the only way to exercise a blocklist revert without
involving a real sanctioned party. It belongs in the Phase 5 testnet plan.

## 8. Compliance — where screening actually happens

This is the input to `ARC-COMPLIANCE-DECISION.md`, and it reframes the question.

| Fact | Class |
|---|---|
| **There is no Chainalysis sanctions-oracle contract on Arc.** | **MEASURED** — absent |
| Arc runs **validator-layer sanctions controls** as part of its network operating model | **DOC** — arc.io/security |
| Blocklisted transfers **revert at the token/protocol layer** | **DOC** |
| Block production is a permissioned set of vetted institutions | **DOC** |
| Arc names Chainalysis, Elliptic and TRM Labs as screening providers | **UNVERIFIED** — secondary sources only; not relied upon |

The absent oracle is therefore **not a hole to be papered over**. On other chains
FurlPay would call a sanctions-oracle contract; on Arc that enforcement has moved
to the validator set and to USDC itself. The compliance question is consequently
not "how do we replace the missing oracle" but "what must our code do differently
given enforcement happens *after* we submit, as a revert" — which is: check
`receipt.status`, classify a blocklist revert, and never retry it.

The UNVERIFIED row is deliberately not load-bearing anywhere.

## 9. Corrections to things we or others got wrong

Kept because each was believed at some point in this project.

| Claim | Status | Evidence |
|---|---|---|
| "CCTP domain 26 is Arc **testnet only**" | **FALSE** | A GitHub issue and one secondary article say this. The live **mainnet** MessageTransmitterV2 answers `localDomain() -> 26`, and Arc publishes mainnet CCTP addresses. Primary source over secondary. |
| "Arc USDC is a deployed token contract" | **Misleading** | It is an ERC-20 *interface* onto the native gas balance at a precompile-shaped address behind an EIP-1967 proxy. There is nothing wrapped. |
| "`balanceOf` == 0 means the account is empty" | **FALSE** | The 6dp view truncates sub-`1e-6` amounts. **MEASURED**: `984085784575` wei of dust invisible to `balanceOf`. |
| "Arc finality needs confirmation depth" | **FALSE** | Finality is deterministic on inclusion. Waiting N blocks is latency with no safety benefit. |
| "FurlPay is live on Arc" | **FALSE** | **MEASURED**: no contract addresses recorded anywhere in the repo, no `deployments/` directory, no broadcast artifacts. Nothing is deployed to any chain. |
| `docs.arc.network` is the docs host | **Stale** | 301 → `docs.arc.io`. |

## 10. What is NOT established

Stated so the gaps are not mistaken for settled facts.

- **Arc's precompile address set.** The docs state that value transfers to
  precompiles revert but never enumerate them. No list is hardcoded anywhere in
  our code; a guessed list would refuse legal recipients and still miss real
  ones.
- **Whether contract deployment is permissioned.** Secondary sources quote Arc
  as saying developers "can deploy contracts and send transactions without
  approval", but we could not confirm this on an official page. Treat as an open
  question to resolve on **testnet** before any mainnet plan depends on it.
- **Testnet behavioural parity with mainnet.** Assumed, unverified. Everything
  MEASURED above was measured on mainnet.
- **Whether Arc's validator-layer screening is observable to a submitter** other
  than as a revert. Unknown.
- **Gas cost of our contracts on Arc.** Unmeasurable before a testnet deploy.

## Reproducing the measurements

All measurements used plain JSON-RPC against `https://rpc.mainnet.arc.io` — no
key, no SDK:

```bash
# chain id
curl -s https://rpc.mainnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

# the dual emitter, over a recent window
curl -s https://rpc.mainnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
        "fromBlock":"0x1589F3A","toBlock":"0x158A12A",
        "topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}]}'
```

Anything in this file that cannot be reproduced this way, or followed to one of
the URLs in **Primary sources**, should be treated as unverified and removed.
