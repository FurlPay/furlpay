# Ethereum USDC index — storage

Labels: **MEASURED** (a tool in this repo, recorded inputs), **PROJECTED**
(arithmetic on measured values, formula shown), **PENDING** (needs the
completed census; filled from [ETHEREUM-USDC-MEASUREMENT.md](ETHEREUM-USDC-MEASUREMENT.md)).

## 1. Bytes per event — MEASURED

Tool: `npm run usdc:bench -- --db` (`scripts/onchain/usdc-index-bench.mjs`).
Input: 97,230 real finalized Transfer events, Ethereum blocks
26,139,754–26,140,753 (finalized hash `0x6eba12bb…b3ea`), PostgreSQL 18.4
(embedded, Windows x64), `vacuum analyze` before sizing.

| Schema | Heap | Indexes | Table + indexes | WAL written | Insert rate (2,000-row batches) |
|---|---|---|---|---|---|
| spec (text hex columns, 7 indexes incl. amount, time, tx hash) | 390.1 B | 541.4 B | **932.0 B** | 1,596.5 B | — |
| compact (bytea, PK tx_hash+log_index, sender, recipient, BRIN block) | 141.3 B | 189.9 B | 331.6 B | 582.3 B | 39,407 /s |
| **lean (bytea, PK block+log_index, sender, recipient) — chosen** | 141.3 B | 142.4 B | **284.1 B** | 523.5 B | 40,289 /s |
| lean + address dictionary (int4 ids) | 109.3 B | 103.4 B | 213.1 B + 138.9 B per new address | 543.1 B | 24,382 /s |

Per index (lean): primary key 31.8 B, sender 54.2 B, recipient 56.5 B. A
`(tx_hash, log_index)` key costs 78.8 B; a tx-hash index another ~50 B.
Raw RPC JSON for the same events: 635.7 B/event — that is transfer size, not
storage size. Batch size barely matters (lean: 500 → 40,436/s, 2,000 →
42,831/s, 5,000 → 46,002/s). Replaying every batch inserted 0 rows in every
variant (idempotent).

Production row (migration 0036) = lean + `block_time timestamptz` (8 B) and
`kind smallint` (2 B, already in the benchmark) → **≈ 292 B/event**
(PROJECTED: 284.1 + 8).

Aggregate rows — MEASURED/derived from the column sizes in 0036:

| Row | Size |
|---|---|
| hourly row without sketches (benchmark: 8,760 rows) | 146.8 B |
| hourly top-10 jsonb | ≈ 1.9 KB (10 × ~190 B text) |
| hourly sketches (2 × 4,096 B, p=12), only within retention | 8 KiB |
| daily sketches (2 × 16,384 B, p=14), kept | 32 KiB (before TOAST compression) |

## 2. Event rate — MEASURED

- Recent: **29,030 events in the hour ending 2026-10-07 14:21:11 UTC**
  (live end-to-end run, finalized blocks) → 696,720 events/day.
- 50-block sample (blocks to 26,140,753): 4,977 events → ~99.5 events/block.
- Lifetime by year and the historical average: **PENDING** (census).

## 3. Projections — PROJECTED

Assumption stated, not hidden: the recent rate (696,720/day, 254.3 M/year) held
flat. It is the 2026 rate; earlier years were lower (census by year, PENDING).

| Events | spec (932 B) | compact (332 B) | **lean / 0036 (292 B)** | dict (213 B + addresses) |
|---|---|---|---|---|
| 1 M | 0.93 GB | 0.33 GB | **0.29 GB** | 0.21 GB + dict |
| 100 M | 93 GB | 33 GB | **29 GB** | 21 GB + dict |
| 1 B | 932 GB | 332 GB | **292 GB** | 213 GB + dict |
| 1 year (254 M) | 237 GB | 84 GB | **74 GB** | 54 GB + dict |
| 3 years (763 M) | 711 GB | 253 GB | **223 GB** | 163 GB + dict |
| 5 years (1.27 B) | 1,185 GB | 422 GB | **371 GB** | 271 GB + dict |
| Full history | PENDING | PENDING | PENDING | PENDING |

Add ~20–30% for page fill, dead tuples between vacuums and index bloat on an
insert-only table with rolling deletes (estimate, not measured). WAL is
transient: 524 B/event (lean) is written once and recycled after checkpoints;
it matters for write throughput and point-in-time-recovery retention, not
steady-state size.

The address dictionary pays when `unique_addresses / events < 0.51`
(71 B saved per event vs 139 B per entry). Interim census ratio (blocks to
11.9 M): 3.18 M / 12.36 M = 0.26 → ~35 B/event net saving (12%), at 40% lower
insert throughput and a second write per new address. Not adopted: the
production table holds a 30-day window, where the saving is ~0.2 GB.

## 4. Retention decision

Production (migration 0036):

| Data | Kept | Size |
|---|---|---|
| `usdc_transfers` raw events | **30 days** (`USDC_INDEX_RETENTION_DAYS`) | 20.9 M × 292 B ≈ **6.1 GB** (+ bloat ≈ 7.5 GB) |
| hourly rows (counts, sums, top-10) | forever | ≈ 2 KB × 8,760 ≈ 18 MB/year |
| hourly sketches | 30 days | 720 × 8 KiB ≈ 5.9 MB |
| daily rows + p=14 sketches | forever | ≈ 34 KB × 365 ≈ 12 MB/year |
| totals | forever | one row |
| range audit (`usdc_ranges`, sha256 per range) | forever | live: ~52k ranges/year × ~200 B ≈ 10 MB/year |

How each dashboard need is served without full raw history:

| Need | Within 30 days | Older |
|---|---|---|
| 1H / 24H / 7D / 30D / 90D / ALL counts + volume | aggregates | aggregates (exact, kept forever) |
| unique senders/receivers | hourly/daily sketches (APPROXIMATE) | daily sketches (APPROXIMATE) |
| largest transfers | events / hourly top-10 | daily top-10 |
| transaction lookup | node receipt + indexed rows | node receipt (archive RPC) — the chain is the source |
| address lookup | indexed rows | archive `eth_getLogs` filtered by the address topic (cheap: bloom-indexed) |
| audit | rows + digest | re-read the range from the chain, compare to the stored sha256 digest |

Raw history beyond the window is **not deleted from anywhere authoritative**:
it is on chain. Keeping it in Postgres is a cost decision (≈ 74 GB per year of
data at the current rate, PROJECTED), reversible by raising
`USDC_INDEX_RETENTION_DAYS` before the backfill runs. Partitioning was not
adopted for a 30-day window (daily delete of ~0.7 M rows); it becomes
worthwhile (monthly range partitions, drop instead of delete) if retention is
raised to a year or more.

## 5. Benchmarks still owed

- eth_getLogs at 1/2/4/8 workers: `npm run usdc:bench -- --rpc`, run after the
  census so the two do not share provider rate limits. PENDING.
- Live index throughput — MEASURED in the end-to-end test (keyless pool,
  real PostgreSQL): 13,462 events / 150 blocks in 12.7 s (live) and 99,240
  events / 1,000 blocks in 37.7 s (backfill), dominated by RPC; the database
  side measured 40k+ inserts/s. Ethereum produces ~8 events/s.
