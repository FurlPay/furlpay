# USDC intelligence — audit before V2

Written 2026-09-29 by inspecting the code and the live database, not the docs.

## CURRENT ARCHITECTURE

Scheduled CLI (`run-usdc.cmd tick`, Windows Task Scheduler), not a daemon. One
process per tick, single-writer lease in SQLite. Cursor-based polling:

    eth_getLogs(USDC contract, Transfer topic, [cursor+1 .. head])
      -> normalise -> classify -> resolve entities -> relay check -> insert
      -> select alert candidates -> Discord -> daily roll-up

Modules: `scanner.ts` (EVM), `solanaScanner.ts` (Helius, tracked-address only),
`cctpScanner.ts` + `iris.ts` (CCTP V2), `classify.ts`, `entities.ts`, `daily.ts`,
`tick.ts`, `embeds.ts`, `metrics.ts`, `lease.ts`. 15 migrations.

## CURRENT DATA SOURCES

Alchemy first where the network is enabled on the account, then public RPC, chosen
by ordered fallback in `EvmProvider.listFor`. Helius for Solana. Circle Iris for
CCTP attestation. **Whichever endpoint answers first is trusted absolutely — there
is no cross-validation and no record of which provider served a given row beyond a
coarse `source` column.**

## CURRENT CHAINS

12 EVM scanned chain-wide + Solana per-address. Ethereum, Avalanche, OP Mainnet,
Arbitrum, Base, Polygon PoS, Unichain, Linea, Sonic, World Chain, Celo, ZKsync Era.

## CURRENT USDC CONTRACTS

`registry.ts`, verified on chain (`usdc verify` reads `symbol()`/`decimals()`).
Identity is `(chainSlug, contractOrMint)` exact match — never symbol. Bridged USDC
is excluded by *absence* from the registry rather than by being recorded as bridged.

## CURRENT EVENT DETECTION

ERC-20 `Transfer` logs. Event identity is `UNIQUE(chain_slug, tx_hash, log_index)`
— already the correct composite key. Timestamps come from `blockTimestamp` on the
log where the endpoint supplies it, else batched header reads.

## CURRENT CCTP DETECTION

Already a two-sided correlation, not an address check: `DepositForBurn` on the
source, `MessageReceived` + `MintAndWithdraw` paired by transaction on the
destination, joined on Circle's nonce via Iris with a deterministic fallback key.
Body version 1 is required. Records *how* each pair was matched.

## CURRENT ENTITY RESOLUTION

A hand-seeded address->label map plus `FURLPAY_TRACKED_WALLETS`. No clustering, no
evidence trail, no confidence beyond a hardcoded 0.95/0.5. Unknown rate is high.

## CURRENT EXCHANGE DETECTION

Derived from the seed map only: deposit if the destination is labelled CEX and the
source is not, withdrawal if the reverse. No `exchange_internal` beyond a
same-entity check. No evidence recorded.

## CURRENT GEOLOCATION

**None.** No region, country, timezone or behavioural profiling exists.

## CURRENT RECONCILIATION

`usdc_scan_runs` records per-scan provenance (range, logs seen, rows new, drops by
reason, error). `usdc integrity` asserts stored-data invariants. Neither proves
*coverage*: there is no record of which block ranges were completely scanned, so a
gap is invisible.

## CURRENT GAPS — what V2 must fix, in severity order

1. **No block ledger.** No block hash, no parent hash, no per-block record. Reorg
   detection is impossible; a reorged transfer stays in every total forever.
2. **No finality model.** Every row is implicitly final the instant it is seen.
   Measured finality lag is 83 blocks on Ethereum and 4,127 on Arbitrum, so the
   newest rows in the table are routinely not yet final.
3. **No coverage proof.** Scanned ranges are recorded per run but never merged, so
   "did we miss a block?" cannot be answered.
4. **No provider cross-validation.** Provider disagreement is undetectable.
5. **`removed` logs ignored.** `eth_getLogs` can return `removed: true` on a
   reorg; the field is not read.
6. **Registry lacks provenance fields** — no assetId, issuer, native/bridged flag,
   or validity window, so bridged USDC is excluded by omission rather than by data.
7. No movement graph, no anomaly scoring beyond a USD threshold, no geography.

## MEASURED FINALITY (probed live, 2026-09-29)

All 12 chains answer `eth_getBlockByNumber("finalized")`. Polygon rejects `"safe"`.
`latest - finalized`, in blocks:

    ethereum 83 · base 529 · arbitrum 4127 · optimism 786 · polygon 0
    avalanche 6 · unichain 1168 · linea 0 · sonic 0 · celo 1107
    zksync 2037 · worldchain 607

Polygon, Linea and Sonic report `finalized == latest`. That is an *optimistic* tag
from a sequencer, not settled finality, so the finality engine applies a minimum
confirmation floor per chain rather than trusting the tag alone.

## PHASE 1 SCOPE (data correctness only)

Block ledger + coverage ranges + gap detection + reorg handling + finality engine +
provider cross-validation + registry provenance + a reconciliation command that
proves coverage instead of asserting it. Phases 2-6 are deliberately not started.
