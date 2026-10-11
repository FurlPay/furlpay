# Ethereum USDC indexer — design

Status: **implemented, not applied**. Code and migration
`supabase/migrations/0036_usdc_index.sql` are committed; the migration has NOT
been applied to any production database and no production index has run.
Implementation map: `apps/web/src/lib/onchain/usdcIndex/` (`rpcPool.ts`,
`scan.ts`, `hll.ts`, `indexer.ts`, `view.ts`), routes under
`/api/onchain/token/usdc/*` and `/api/cron/usdc-index`, worker
`scripts/onchain/usdc-index-worker.mjs`, panel
`components/onchain/usdcIndex.tsx`. It builds on the measurement in
[ETHEREUM-USDC-MEASUREMENT.md](ETHEREUM-USDC-MEASUREMENT.md) and the storage
numbers in [ETHEREUM-USDC-STORAGE.md](ETHEREUM-USDC-STORAGE.md); the API is
in [ETHEREUM-USDC-API.md](ETHEREUM-USDC-API.md).

Labels used throughout:

- **MEASURED** — produced by a tool in this repo on recorded inputs (block
  range, provider, PostgreSQL version) and reproducible from them.
- **PROJECTED** — arithmetic on measured values; the formula is shown.
- **APPROXIMATE** — an estimator with a stated error (HyperLogLog).

## 1. The invariant

> Raw on-chain events are the source of truth. Aggregates and sketches are
> derived data.

Every aggregate row can be deleted and rebuilt from `token_transfers` (and
`token_transfers` can be rebuilt from the chain for any finalized range).
Nothing on the dashboard is computed from data that cannot be traced back to a
`(chain, block, log index)`.

## 2. What already exists (reused, not duplicated)

| Existing piece | Where | Reused for |
|---|---|---|
| Finalized-only asset index: CAS cursor, parent-hash continuity, exact supply reconciliation (`prev + mint − burn = totalSupply`) | `lib/onchain/assetIndexer.ts`, migration 0034 | The commit protocol below is the same protocol, extended with event rows |
| Adaptive `eth_getLogs` splitting | `lib/onchain/nodeIndexer.ts` (`getLogsAdaptive`) | Live tailing on the configured node |
| Integrity issues table + `onchain_record_issue` | 0034 | All integrity alerts |
| Indexer status (`onchain_indexer_touch`) | 0034 | Head / finalized / lag on the dashboard |
| Worker loop | `scripts/onchain/node-tail.mjs` | Live tailing process |
| Census scanner (per-provider adaptive ranges, provider pool, unit checkpoints) | `scripts/onchain/usdc-history-scan.mjs` | Historical backfill reuses its range planner and provider pool |
| Live lookup on own nodes | `lib/onchain/lookup.ts` | Transaction metadata (gas, status) on demand |

## 3. Pipeline

```
 provider pool (archive RPCs)             configured node (ETHEREUM_RPC_URL)
          │  backfill units                         │ live: finalized watermark
          ▼                                         ▼
  range planner ──► fetch workers (bounded) ──► decoder/validator ──► dedupe
                                                                          │
                                            bounded queue (backpressure) ◄┘
                                                         │
                                                 DB writer (batched txn)
                                                         │
                              token_transfers + blocks + addresses (one txn per range)
                                                         │
                                  aggregator (same txn): hourly/daily/totals + sketches
                                                         │
                                         API (aggregates for windows, events for lookups)
```

### 3.1 Finalized watermark

Two heads are tracked and shown separately:

- **latest** — `eth_getBlockByNumber("latest")`; used only for the live preview
  (the `/api/onchain/lookup` path and the "unfinalized" tag).
- **finalized** — `eth_getBlockByNumber("finalized")`; the only boundary
  durable rows are written up to.

Durable data is finalized-only, so a reorg cannot remove a committed row. The
parent-hash check at each commit (`parent(from) == hash(cursor)`) turns a
finality failure into a refused commit plus a `reorg_inconsistency` issue,
never into silently wrong data. On Ethereum the finalized head trails latest by
~64–95 blocks (~13–19 min): durable charts are that far behind; the live
preview covers the gap and is labelled unfinalized.

### 3.2 Checkpointing and range ownership

- `indexer_checkpoints(stream)`: `finalized_through_block`, its hash, state,
  updated_at. Moved **only** by compare-and-set inside the same transaction
  that writes the range's rows (as `onchain_asset_commit` does today).
- Backfill uses `indexer_ranges(stream, from_block, to_block, status,
  attempts, provider_hosts, events, committed_at)`. A worker claims a range
  with `update … set status='claimed', claimed_at=now() where status in
  ('pending','stale')` (`skip locked`); completion inserts the rows and flips
  the range to `done` in one transaction. Re-running a `done` range is a no-op
  (unique key on events). A crash leaves the range `claimed`; claims older than
  a lease (10 min) return to `stale`.
- Backfill ranges and the live checkpoint are separate: live starts at the
  finalized head at the moment the backfill is planned, so both run at once
  and the history fills in behind live data. Aggregates for a backfilled hour
  are recomputed when its last range lands.

### 3.3 Adaptive ranges (per provider)

For provider *p* with current span *sₚ*, cap *cₚ* (adopted when a provider
states its limit, e.g. "maximum allowed is 50") and response size *n*:

```
on success:  sₚ ← min(cₚ, s_max, 2·sₚ)          if n < 2,500 logs
on range / size / timeout error:  sₚ ← max(1, ⌊sₚ / 2⌋)
on two unexplained errors in a row: sₚ ← max(1, ⌊sₚ / 2⌋)
on rate limit: provider paused for min(120 s, 2^streak s); span unchanged
```

The 2,500-log threshold keeps a response near ~1.6 MB of JSON (MEASURED
~634 bytes of RPC JSON per log). Spans are per provider because limits differ
by orders of magnitude (MEASURED: 10 blocks on blastapi, 50 on nodies, 100 on
tatum, 10,000 on mevblocker/tenderly).

### 3.4 Concurrency and backpressure

- Fetch workers: `INDEXER_CONCURRENCY` (default chosen from the benchmark in
  the storage doc), each owning one range at a time.
- Workers push decoded batches into a bounded queue (capacity in events, e.g.
  200,000 ≈ 40 MB). A full queue blocks the producers; no worker reads ahead.
- One DB writer drains the queue in batches of 2,000–5,000 events per
  transaction (MEASURED 40–46k events/s on the lean schema, PG 18, local).

### 3.5 Decoding and validation

Each log must have: `address == contract`, `topics[0] == Transfer`,
`len(topics) == 3`, 32-byte `data`, block inside the requested range,
`removed == false`. Anything else is a hard error for the range (it is retried
on another provider and, if it persists, the range is marked `failed` and an
integrity issue is raised). Kind: `from == 0x0` → MINT, `to == 0x0` → BURN,
else TRANSFER — verified against the contract: FiatToken's `mint` emits
`Mint` **and** `Transfer(0x0, to, amount)`, `burn` emits `Burn` **and**
`Transfer(burner, 0x0, amount)`; the census identity *minted − burned =
totalSupply()* holds exactly at every checked block, which would fail if any
mint or burn path did not emit the zero-address Transfer.

### 3.6 Deduplication

Event identity: `(stream, block_number, log_index)`. For finalized canonical
data this is equivalent to `(chain_id, tx_hash, log_index)` — a log index is
unique within a block — and its index is 32 bytes/event against 79 for a
`(tx_hash, log_index)` key (MEASURED). Inserts use `on conflict do nothing`;
replaying a range writes nothing (MEASURED: replay of 97,230 events added 0
rows in every variant).

### 3.7 Address dictionary

`addresses(id int4, address bytea unique)`; events store two int4 ids. It
pays when `unique_addresses / events < 0.51`: per-event saving 71 B
(MEASURED: 284 → 213 B) against 139 B per dictionary entry (MEASURED).
**Decision: not adopted in 0036.** Raw events are retained for 30 days
(§3.13), where the saving is ~0.2 GB, and it would cost 40% of insert
throughput (MEASURED 40k → 24k/s) plus a second write per new address.
Revisit if retention is raised to years.

### 3.13 Retention and cold history

`usdc_transfers` keeps `USDC_INDEX_RETENTION_DAYS` (default 30) of finalized
events; `usdc_index_prune` removes older rows and older hourly sketches each
pass. Counts, sums, top-10 lists, daily sketches, totals and the per-range
sha256 audit rows are kept forever. Older transaction lookups use the node's
receipt; older address history uses archive `eth_getLogs` filtered by the
address topic. Sizing in the storage doc.

### 3.14 Provider head guard

MEASURED 2026-10-07: `rpc.mevblocker.io` answers `eth_getLogs` for blocks it
has not reached with an empty list, not an error. The pool therefore asks a
provider only for blocks at or below its own `eth_blockNumber` (refreshed every
60 s), so a lagging provider cannot silently drop finalized events.

### 3.8 Transaction metadata

No `transactions` table. The tx hash is stored on every event (33 B heap, not
indexed). Gas used, gas price, fee, status and `to` are read from the node on
demand (`eth_getTransactionReceipt`, as `/api/onchain/lookup` does) and cached.
A tx lookup asks the node for the receipt's block number, then reads
`token_transfers` by `(stream, block_number)` — an O(log N) primary-key range
scan, without a 50 B/event tx-hash index.

### 3.9 Aggregates

- `hourly_metrics(stream, hour)`: exact counts and raw sums for
  transfer/mint/burn, zero-value count, first/last block, top-10 transfers of
  the hour (jsonb), sender and receiver HLL sketches (p=12, 4 KiB each,
  standard error 1.63%).
- `daily_metrics(stream, day)`: same, sketches at p=14 (16 KiB, 0.81%).
- `stream_totals(stream)`: all-time exact counts/sums through the checkpoint
  block, all-time sketches (p=14). Updated in the commit transaction.

Window evaluation (no event scans):

| Window | Exact metrics | Unique senders/receivers |
|---|---|---|
| 1H | events: `(stream, block)` range for ~300 blocks (MEASURED density ~100 events/block → ~30k rows) | exact `count(distinct)` over those rows |
| 24H | 24 hourly rows | merge 24 p=12 sketches — APPROXIMATE |
| 7D / 30D / 90D | whole days from `daily_metrics`, partial edge days from `hourly_metrics` | merge ≤ 90 daily + ≤ 48 hourly sketches (registers widened by max) — APPROXIMATE |
| ALL | `stream_totals` (O(1)) | all-time sketch — APPROXIMATE |

Unique counts are **never** summed across buckets. Hourly sketches merge into
larger windows by register-wise max, which is exact for HLL (the merged sketch
equals the sketch of the union).

Sketches are computed in the application (the census's p=14 implementation,
MEASURED within 0.5% of exact on the launch period) and stored as `bytea`. No
PostgreSQL extension is assumed: the local PostgreSQL 18 offers none of `hll`,
`timescaledb`, `pg_partman`, `citus` (MEASURED), and the production Supabase
project's extension list has not been inspected (no credentials in this
environment).

### 3.10 Largest transfers and the live feed

- Last minute / last hour: read the last *k* blocks by primary key and sort in
  memory (≤ ~30k rows for an hour).
- 24H and longer: merge the per-hour top-10 lists — O(hours).
- Live feed: newest rows by `(stream, block_number desc, log_index desc)` —
  O(rows returned). No separate recent-events table is needed.

### 3.11 Events/sec

`events in the last 5 finalized minutes / 300`, from the hourly row of the
current hour plus a block-range count of the last ~25 blocks. Defined over
**finalized** time (block timestamps), not wall-clock arrival.

### 3.12 Supply

Current supply: `totalSupply()` at the finalized block (one `eth_call`).
Historical supply: the existing `onchain_supply_snapshots` series. Never summed
from transfers; the transfer-derived value is used only as the reconciliation
check.

## 4. Failure handling

| Failure | Behaviour |
|---|---|
| Provider error / rate limit | Request moves to the next healthy provider; provider paused with exponential backoff; per-provider span adapts |
| Range keeps failing | Range → `failed` after N attempts, integrity issue raised, other ranges continue; coverage report lists it |
| Process killed | Claimed ranges return to `stale` after the lease; committed ranges stay committed; live resumes from the CAS checkpoint |
| DB write fails | The range's transaction rolls back completely (rows + aggregates + checkpoint); the range is retried |
| Parent-hash mismatch at the watermark | Commit refused, `reorg_inconsistency` raised, indexer state → `DEGRADED`; no rows written |
| Supply identity fails | Range committed but flagged `supply_mismatch`; dashboard shows the integrity state |
| Providers disagree (verification sample) | Range marked `disputed`; not counted in published totals until resolved |

State machine shown on the dashboard: `BACKFILLING → CATCHING_UP → LIVE`,
`LIVE ⇄ DEGRADED` (RPC errors or lag > 2 finality windows), `PAUSED`
(operator), `ERROR` (integrity failure needing a human).

## 5. Verification

- **Supply identity** on every committed contiguous prefix.
- **Provider cross-check**: a deterministic sample of committed ranges is
  recounted on each other provider (`usdc:probe:crosscheck`); event count,
  unique transactions and raw sums must match exactly.
- **Aggregate rebuild**: a job rebuilds a random day's hourly/daily rows from
  `token_transfers` and compares byte-for-byte (sketches included — the hash is
  deterministic).
- **Gap audit**: committed ranges must tile `[deploy, checkpoint]` with no gap
  or overlap.

## 6. Observability and alerting

Per worker, logged as structured events (the existing `indexerEvent`):
current/target block, lag, events and blocks per second, per-provider latency,
error, rate-limit counts and span, retries, queue depth, DB batch latency.
Alerts: lag > 2 finality windows for 15 min; any integrity issue; a provider at
100% errors for 10 min; queue full for 5 min.

## 7. Multi-chain

`contracts` (stream) rows carry chain id, address, decimals, finality kind and
event decoder. EVM chains with a `finalized` tag reuse everything here; per-
chain ranges and densities differ (Base/Arbitrum blocks are ~2 s / ~0.25 s).
Solana is a different model (no log filter by contract; signatures per
account) and gets its own ingestion path, sharing only the aggregate tables.
