# Ethereum USDC index — API design

Status: **design only**; none of these routes exist yet. They follow the
repo's conventions (AGENTS.md): Next.js App Router routes under
`/api/onchain/…`, public routes call `rateLimitOr429()`, are registered in
`security/route-manifest.json`, return `{ ok: true, data }` or
`{ ok: false, error: { code, message } }`, and never touch FurlPay user data
(they read public chain data only, so a lookup cannot reveal whether an
address belongs to a FurlPay user).

The paths requested as `/token/usdc/…` are mounted at
`/api/onchain/token/usdc/…`. `chain` defaults to `ethereum`; only configured
streams are accepted (no user-supplied contract address ever reaches an RPC).

## Common rules

- **Amounts**: strings of integer base units (`amountRaw`) plus a decimal
  string (`amount`, = raw / 10^6). Never JS numbers, never currency-formatted.
- **Exactness**: every metric object carries `exact: true` or
  `exact: false, method: "hll-p12" | "hll-p14", stdError: 0.0163 | 0.0081`.
- **Boundary**: every response carries `finalizedThrough: { block, hash, time }`
  — the checkpoint the data reflects — and `state` (`BACKFILLING`,
  `CATCHING_UP`, `LIVE`, `DEGRADED`, `PAUSED`, `ERROR`).
- **Coverage**: while backfill is incomplete, windows that reach before the
  covered range return `coverage: { from, to, complete: false }` instead of
  silently partial numbers.
- **Pagination**: keyset cursors only (`cursor` = opaque base64 of the last
  `(block_number, log_index)`), `limit` ≤ 100. No offsets.
- **Errors**: 400 `invalid_*` for malformed input, 404 `not_found`, 429 rate
  limited, 503 `index_unavailable` (store or node down — never zeros).

## Endpoints

### `GET /api/onchain/token/usdc/metrics?chain=&window=`

`window`: `1h | 24h | 7d | 30d | 90d | all`.

```json
{ "window": "24h", "from": "…", "to": "…",
  "transfers": { "count": 712345, "amountRaw": "…", "amount": "…", "exact": true },
  "mints": { … }, "burns": { … }, "zeroValue": { "count": 812, "exact": true },
  "uniqueSenders": { "count": 151234, "exact": false, "method": "hll-p12", "stdError": 0.0163 },
  "uniqueReceivers": { … },
  "eventsPerSecond": { "value": 8.21, "definition": "finalized events in the last 300 s of block time / 300" },
  "supply": { "amountRaw": "…", "atBlock": 26140753, "source": "totalSupply()" } }
```

Cost: 1h → one primary-key range scan of ~300 blocks; 24h → 24 hourly rows;
7d–90d → ≤ 90 daily + ≤ 48 hourly rows; all → one `stream_totals` row. Cache
`s-maxage=15`.

### `GET /api/onchain/token/usdc/metrics/hourly?chain=&from=&to=`
### `GET /api/onchain/token/usdc/metrics/daily?chain=&from=&to=`

Series rows `{ bucket, transfers, transferRaw, mints, mintRaw, burns, burnRaw,
uniqueSenders, uniqueReceivers }` (uniques per bucket, approximate). Max span:
hourly 31 days, daily unlimited. Cache `s-maxage=60`; closed buckets are
immutable and cached for a day.

### `GET /api/onchain/token/usdc/volume?chain=&window=&bucket=`

Convenience over the series: totals and a series of transfer volume, minted,
burned, net supply change. `bucket` ∈ `hour | day`.

### `GET /api/onchain/token/usdc/transfers?chain=&window=&sort=&kind=&limit=&cursor=`

- `sort=recent` (default): newest first by `(block, log index)`; any window.
- `sort=largest`: 1h → sorted block-range scan; 24h–90d → merged per-hour
  top-10 lists (`limit` ≤ 10 × hours); `all` not supported (400).
- `kind`: `transfer | mint | burn | all`.

Row: `{ block, logIndex, txHash, txIndex, time, from, to, amountRaw, amount,
kind, explorerUrl }`.

### `GET /api/onchain/token/usdc/transactions?chain=&window=&limit=&cursor=`

Transactions with at least one USDC Transfer, newest first: `{ txHash, block,
time, events, amountRaw }`. Built from `token_transfers` grouped by tx within
the page's block range.

### `GET /api/onchain/token/usdc/tx/:hash?chain=`

1. Validate `^0x[0-9a-f]{64}$`.
2. Ask the configured node for the receipt (block number, status, gas used,
   effective gas price, fee) — the same path as `/api/onchain/lookup`.
3. Read the block's rows from `token_transfers` (primary-key range) and keep
   those with the hash.
4. Return both, labelled: `index: { events: [...] }` (finalized only) and
   `node: { status, gasUsed, effectiveGasPrice, feeWei, finality }`. A tx
   newer than the checkpoint returns `index: { pending: true }`.

### `GET /api/onchain/token/usdc/address/:address?chain=&window=`

Validate the address. Returns totals in/out, net flow, transfer count,
first/last seen (exact, from `(recipient|sender, block)` index scans bounded
by the window), largest transfer, top counterparties by volume (limit 25),
recent transfers (keyset paginated), current balance from `balanceOf` at the
finalized block (node read).

Windows over `all` for a very active address (exchanges with millions of
events) are capped: the response returns `truncated: true` and the scanned
block range instead of timing out. Cache `s-maxage=30`.

### `GET /api/onchain/token/usdc/addresses?chain=&window=&sort=&limit=`

Top senders / receivers / net accumulators / net distributors for `1h` and
`24h` (computed from events, cached for one finalized block), and for longer
windows from a periodically materialised ranking (`computedAt`, block range
returned). No unbounded aggregation on request.

## Rate limits (per IP, per minute)

| Route | Limit |
|---|---|
| metrics, metrics/hourly, metrics/daily, volume | 60 |
| transfers, transactions | 30 |
| address/:address, tx/:hash | 20 (node reads) |
| addresses | 20 |
