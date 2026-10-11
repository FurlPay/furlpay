# Ethereum mainnet native USDC — lifetime census

**Status: complete, MEASURED.** Every `Transfer` log of native USDC on Ethereum
mainnet from the contract's deployment through a fixed finalized block,
counted directly from Ethereum archive RPC nodes. Nothing here is extrapolated
from a sample. Run 2026-10-07 13:17 UTC → 2026-10-08 01:00 UTC.

Labels: **MEASURED** (counted), **APPROXIMATE** (HyperLogLog, stated error),
**PROJECTED** (arithmetic on measured values; see ETHEREUM-USDC-STORAGE.md).

## Boundary (immutable for this run)

| | |
|---|---|
| Network | Ethereum mainnet (chain id 1) |
| Contract | `0xA0b86991c6218b36c1d19D4a2e9eB0cE3606eB48` (native USDC proxy) |
| Event | `Transfer(address,address,uint256)`, topic `0xddf252ad…523b3ef` |
| Deployment block | **6,082,465** — first block with contract code (binary search on archive state; no code at 6,082,464; 4 providers agree) |
| Last block | **26,140,753** (finalized tag at the start of the run) |
| Last block hash | `0x6eba12bbbc8f4c5eabfb56e9939041878d5017176ae278cbf1e57a91be29b3ea` |
| Last block time | 2026-10-07 13:17:11 UTC |
| Blocks scanned | **20,058,289** (2,006 units of 10,000 blocks; 2,006/2,006 complete, contiguous) |

## Result

| Metric | Value | Label |
|---|---|---|
| **Transfer events** | **390,926,854** | MEASURED |
| **Unique Ethereum transactions with ≥1 USDC Transfer** | **222,626,568** | MEASURED |
| Average Transfer events per transaction | 1.7560 | MEASURED |
| Maximum Transfer events in one transaction | 1,287 (`0x9079946d…6c9f15`) | MEASURED |
| Mint events (from 0x0) | 2,004,442 | MEASURED |
| Mint volume | 748,561,446,251.026168 USDC | MEASURED |
| Burn events (to 0x0) | 1,235,494 | MEASURED |
| Burn volume | 699,416,242,308.954589 USDC | MEASURED |
| **Net supply change (minted − burned)** | **49,145,203,942.071579 USDC** | MEASURED |
| Regular transfer events | 387,686,918 | MEASURED |
| Regular transfer volume | 34,728,257,401,780.923156 USDC | MEASURED |
| All events volume (incl. mint/burn) | 36,176,235,090,340.903913 USDC | MEASURED |
| Average event size | 92,539.652163 USDC | MEASURED |
| Zero-value transfers | 21,665,427 | MEASURED |
| Largest single transfer | 1,779,000,000.263006 USDC (block 15,356,930, `0x09f0c36b…421669d`) | MEASURED |
| Smallest non-zero transfer | 0.000001 USDC | MEASURED |
| Median transfer | in [134.217728, 268.435456) USDC (exact power-of-two bin) | MEASURED |
| First transfer | block 6,307,510, 2018-09-10 18:26:41 UTC (`0xdc6bb2a1…f5983e`) | MEASURED |
| Latest transfer in range | block 26,140,753, 2026-10-07 13:17:11 UTC | MEASURED |
| Unique addresses (senders ∪ receivers) | ≈ 41,840,342 | APPROXIMATE (HLL p=14, σ 0.81%) |
| Unique senders | ≈ 34,037,664 | APPROXIMATE |
| Unique receivers | ≈ 41,784,573 | APPROXIMATE |
| Unique sender→receiver pairs | ≈ 105,570,555 | APPROXIMATE |

The four metrics are distinct and not interchangeable: **total supply**
(49.15 B USDC, a balance) · **transfer count** (390.9 M events) ·
**Ethereum transaction count** (222.6 M) · **transfer volume** (34.7 T USDC
regular, 36.2 T including mint/burn, a flow).

### Integrity check against the chain — exact

`totalSupply()` at block 26,140,753 = **49,145,203,942.071579** USDC, equal to
minted − burned over the whole scan **to the last base unit**. Any missed or
double-counted mint or burn anywhere in eight years would break this.
(FiatToken emits `Transfer(0x0, to)` on every mint and `Transfer(from, 0x0)` on
every burn; this identity is what verifies that.)

## Activity by year — MEASURED (events; year of each unit's last block)

| Year | Transfer events |
|---|---|
| 2018 | 49,373 |
| 2019 | 1,091,899 |
| 2020 | 8,395,205 |
| 2021 | 22,762,170 |
| 2022 | 24,593,338 |
| 2023 | 22,326,843 |
| 2024 | 31,320,433 |
| 2025 | 108,854,307 |
| 2026 (to 7 Oct) | 171,533,286 |

Rates: historical average **132,572 events/day** (19.49 per block); recent
(last 100,000 blocks) **622,786 events/day** (86.89 per block); 2026 to date
612,619/day. The earlier 50-block sample (≈99.5/block, ≈716,688/day) was a
busy window; it is not used for any number above.

## Raw RPC volume — MEASURED

247.86 GB of JSON-RPC response bodies (634.0 bytes per event) were read to
produce this. That is transfer size, not storage size (see the storage doc).

## Providers — MEASURED (requests over the whole run)

| Provider | Successful | Range errors | Rate-limited | Other errors | Avg latency | Stated cap |
|---|---|---|---|---|---|---|
| eth-mainnet.public.blastapi.io | 102,734 | 8 | 2 | 9 | 318 ms | 10 blocks |
| rpc.sentio.xyz | 36,321 | 24,140 | 0 | 7 | 673 ms | — |
| rpc.mevblocker.io | 21,697 | 1,302 | 4,741 | 24 | 963 ms | — |
| mainnet.gateway.tenderly.co | 13,849 | 3 | 3,866 | 723 | 892 ms | — |
| eth-pokt.nodies.app | 10,024 | 29 | 549 | 6 | 972 ms | 50 blocks |
| ethereum.public.blockpi.network | 1,199 | 27 | 0 | 272 | 18,985 ms | — |
| ethereum-mainnet.gateway.tatum.io | 703 | 6 | 1,089 | 9 | 2,766 ms | 100 blocks |

No Alchemy, no explorer. Unit retries: 28,724 (absorbed by provider rotation);
4 unit attempts failed and were retried to completion; 0 units missing.

## Verification

1. **Supply identity** — exact (above).
2. **Launch-period independent recount** — 62/62 units recounted only on
   providers that did not serve them; every exact field and the HLL sketch
   bytes identical.
3. **Full independent recount** — every unit recounted on providers disjoint
   from the census's; running at the time of writing
   (`C:\Users\ashut\furlpay-usdc-verify`, compare with
   `npm run usdc:probe:crosscheck -- --out <census> --compare <verify>`).
   Result to be recorded here when complete.
4. **Index cross-check** — the production indexer (migration 0036) indexed
   1,150 blocks of real mainnet into PostgreSQL and matched an independent
   recount exactly (112,702 events / 64,910 transactions).

No external dashboard number was used. A comparison with an explorer or
analytics vendor would have to match this boundary (deployment → block
26,140,753, native contract only, events not transactions) to be meaningful.

## Reproduce

```bash
npm run usdc:probe -- --out <dir> --to 26140753 --workers 24 --per-provider 3
npm run usdc:probe:report -- --out <dir>
```

Same boundary, same contract and topic ⇒ the same exact counts and sums; the
HLL sketches are deterministic for the same input. Artefacts of this run:
`C:\Users\ashut\furlpay-usdc-scan\` (`plan.json`, `units.jsonl` — one line per
unit with its counts, sums, extremes, histogram, providers — `sketches/`,
`report.json`, `providers.json`); a copy of `plan.json` and `report.json` is
committed under `docs/onchain/data/`.
