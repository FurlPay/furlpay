# Ethereum USDC index — storage

Labels: **MEASURED** (a tool in this repo, recorded inputs), **PROJECTED**
(arithmetic on measured values, formula shown), **APPROXIMATE** (HyperLogLog,
stated error). Lifetime counts come from the completed census,
[ETHEREUM-USDC-MEASUREMENT.md](ETHEREUM-USDC-MEASUREMENT.md).

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

## 2. Event rate — MEASURED (lifetime census, ETHEREUM-USDC-MEASUREMENT.md)

- Lifetime: **390,926,854** Transfer events in 20,058,289 blocks
  (deployment 6,082,465 → finalized 26,140,753): 132,572/day on average,
  19.49 per block.
- Recent (last 100,000 blocks): **622,786 events/day**, 86.89 per block
  (227.3 M/year). 2026 to 7 Oct: 612,619/day.
- By year: 2021 22.8 M · 2022 24.6 M · 2023 22.3 M · 2024 31.3 M ·
  2025 108.9 M · 2026 (to 7 Oct) 171.5 M.
- Unique addresses (APPROXIMATE, HLL ±0.81%): 41.8 M over the lifetime —
  0.107 addresses per event.

## 3. Projections — PROJECTED

Formula: events × measured bytes/event (section 1). Forward years assume the
recent measured rate (622,786/day) held flat — 2025→2026 grew 3×, so treat
these as a floor, not a forecast. The dictionary column adds 138.9 B per
unique address at the lifetime ratio (0.107 addresses/event).

| Events | spec (932 B) | compact (332 B) | **lean / 0036 (292 B)** | lean + dictionary |
|---|---|---|---|---|
| 1 M | 0.9 GB | 0.3 GB | **0.3 GB** | 0.2 GB |
| 100 M | 93.2 GB | 33.2 GB | **29.2 GB** | 22.8 GB |
| 1 B | 932.0 GB | 331.6 GB | **292.1 GB** | 228.0 GB |
| 1 year (227.3 M) | 211.9 GB | 75.4 GB | **66.4 GB** | 51.8 GB |
| 3 years (681.9 M) | 635.6 GB | 226.1 GB | **199.2 GB** | 155.5 GB |
| 5 years (1.14 B) | 1,059.3 GB | 376.9 GB | **332.0 GB** | 259.1 GB |
| **Full history (390.9 M, MEASURED count)** | 364.3 GB | 129.6 GB | **114.2 GB** | 89.1 GB |

Add ~20–30% for page fill, dead tuples between vacuums and index bloat on an
insert-only table with rolling deletes (estimate, not measured). WAL is
transient: 524 B/event (lean) is written once and recycled after checkpoints;
it matters for write throughput and point-in-time-recovery retention, not
steady-state size.

The address dictionary pays when `unique_addresses / events < 0.51`
(71 B saved per event vs 139 B per entry). Measured lifetime ratio: 0.107 →
56 B/event net saving, about 22% of full history (114.2 → 89.1 GB), at 40%
lower insert throughput and a second write per new address. Not adopted for
the 30-day window (saves ~1 GB); adopt it if retention is raised to years.

## 4. Retention decision

Production (migration 0036):

| Data | Kept | Size |
|---|---|---|
| `usdc_transfers` raw events | **30 days** (`USDC_INDEX_RETENTION_DAYS`) | 18.7 M × 292 B ≈ **5.5 GB** (+ bloat ≈ 7 GB) |
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
it is on chain. Keeping it in Postgres is a cost decision (≈ 66 GB per year of
data at the measured recent rate, PROJECTED), reversible by raising
`USDC_INDEX_RETENTION_DAYS` before the backfill runs. Partitioning was not
adopted for a 30-day window (daily delete of ~0.7 M rows); it becomes
worthwhile (monthly range partitions, drop instead of delete) if retention is
raised to a year or more.

## 5. Benchmarks — MEASURED

eth_getLogs throughput by worker count (`npm run usdc:bench -- --rpc`, 1,000
finalized blocks 26,143,196–26,144,195, 65,731 events, mevblocker + tenderly,
run after the census so they did not share rate limits). Three runs; the first
had one throttled request at 4 workers (16 blocks/s) and is not representative.

| Workers | blocks/s | events/s | avg latency | CPU (cores) | peak RSS |
|---|---|---|---|---|---|
| 1 | 56–104 | 3.7k–6.8k | 480–900 ms | 0.1 | 92 MB |
| 2 | 125–144 | 8.2k–9.5k | 690–780 ms | 0.15–0.2 | 100–108 MB |
| 4 | 335–352 | 22.0k–23.2k | 530–550 ms | 0.3–0.4 | 169 MB |
| 8 | 583–630 | 38.3k–41.4k | 460–610 ms | 0.4–0.5 | 195–205 MB |

Scaling is near-linear to 8 workers; the limit is provider rate limiting, not
CPU or memory. Census sustained 9k–30k events/s over 11.7 h with 24 workers
and 3 in flight per provider across 7 providers.

Database side (section 1): 40–46k inserts/s on the lean schema; the indexer
end-to-end run (keyless pool, real PostgreSQL) did 13,462 events / 150 blocks
in 12.7 s live and 99,240 events / 1,000 blocks in 37.7 s backfill, RPC-bound.

**Production configuration.** Live: one worker is ample — Ethereum produces
~7–8 finalized events/s. Backfill: 8 workers, 3 in flight per provider (the
rpcPool defaults); a full 30-day raw backfill (18.7 M events) is ~10–20 min of
RPC at 8 workers, aggregates for full history ~3–6 h at the census rate.
