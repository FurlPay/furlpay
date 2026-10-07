# Allium integration — onchain ingestion and the /onchain dashboard

Status: code complete behind configuration. Nothing flows until the
production setup at the end of this document is done.

## What is the canonical source of truth?

- **FurlPay's financial ledger** (`ops_tx_events`, the ledger tables, balances,
  payments, settlements) is the source of truth for financial state.
- **Allium** is an external source of blockchain analytics and enrichment. Its
  data is stored in a separate read model (`onchain_*` tables). It never posts
  to the ledger, never changes a balance, payment, settlement or withdrawal,
  and never triggers a money movement. When the chain and the ledger disagree,
  the event is flagged `reconciliation_required` and a `financial.onchain_ledger_mismatch`
  alert is raised. Nothing is written back.

## Allium products used (verified against docs.allium.so, October 2026)

| Purpose | Product / endpoint | Notes |
|---|---|---|
| Realtime ingestion (primary) | **Beam** pipeline, `erc20_token_transfer` source, **webhook sink** | Beam pushes each record as an HTTPS POST. Sources include Base and Polygon (`erc20_token_transfer`, zerolag-capable) and Solana (`nonvoting_transaction`). The exact chain/entity list is shown in the Beam UI. |
| Webhook authentication | Beam HMAC | `X-Webhook-Timestamp`, `X-Webhook-Nonce` (UUID v4), `X-Signature-256: sha256=<hex>` over `nonce.timestamp.raw_body`. Signing is opt-in per sink via `hash_key`. |
| Backfill + reconciliation | Realtime API `POST /api/v1/developer/wallet/transactions` | 1–20 `{chain,address}` pairs, `limit` ≤ 1000, `cursor`. Returns `asset_transfers[]` with `log_index` and `block_hash`. |
| Chain discovery | `GET /api/v1/supported-chains/realtime-apis` (public) | 19 chains supported `wallet_transactions` on 2026-10-07. They are read at runtime, not hard-coded. |
| Market cards | Explorer API saved queries (`GET /api/v1/explorer/query-runs?query_id=`) | Existing; see `lib/onchain/allium.ts`. |

Not used: Datastreams via Kafka, Pub/Sub or SNS. These are consumer-group
transports that need a long-running consumer, which Vercel functions are not.
Beam's webhook sink is the push transport that fits this deployment. The
Allium MCP server and machine payments (x402) are also not used; x402 spends
real USDC per call.

**Schema caveat.** Allium does not publicly document the field-level schema of
Beam/Datastreams records. The normalizer accepts Allium's documented ERC-20
transfer columns from the data catalog (`transaction_hash`, `log_index`,
`block_number`, `block_hash`, `block_timestamp`, `from_address`, `to_address`,
`token_address`, `token_symbol`, `raw_amount_str`, `amount_str`, `usd_amount`,
`unique_id`). Any record that does not match goes to `onchain_dead_letters`
with the reason. Check the dead-letter table after the first real delivery.

## Data flow

```
Allium Beam (erc20_token_transfer, filtered to tracked addresses)
   │  HTTPS POST, HMAC-signed
   ▼
POST /api/webhooks/allium
   1 size/content-type limits     5 normalize (exact string amounts only)
   2 HMAC over raw body           6 scope: linked wallet | treasury | watch list
   3 zstd decode (if enabled)     7 onchain_ingest()  ← idempotent, reorg-aware
   4 nonce check (replay)         8 claim nonce
   ▼
Supabase: onchain_events ── onchain_hourly (rollup) ── onchain_event_revisions (audit)
   ▲                                     │
   │ daily cron + POST /api/ops/onchain/sync
   │ (Realtime API backfill/reconcile)   ▼
   │                         GET /api/onchain/live (2 s shared snapshot)
   │                         GET /api/onchain/stream (SSE change notifications)
   ▼                                     ▼
correlateLedger → flag only        /onchain (Real-time Activity, badge, drawer, search)
```

## Identity, idempotency, ordering

- `event_key = "<chain>:<tx_hash>:<log_index>"`, lowercased for EVM. This is
  the same identity as Allium's `unique_id` (tx hash + log index). Native
  transfers have no log index; their key is `<chain>:<tx>:native:<from>:<to>:<raw>`.
- `onchain_events.event_key` is UNIQUE. `onchain_ingest(jsonb)` is the only
  write path:

| Delivery | Result |
|---|---|
| New key | inserted |
| Same key, same block, same or lower state | duplicate (no change) |
| Same key, same block, higher state | promoted (observed → confirmed → finalized; never backwards, so out-of-order deliveries cannot regress state) |
| Same key, different `block_hash` | reorg_replaced; the old version is kept in `onchain_event_revisions` |
| Same key, row was `reorged` | reinstated |

- Proven on real PostgreSQL 18 by `scripts/db/verify-onchain-ingest.mjs`:
  20 concurrent deliveries give 1 row; replays are no-ops; revisions are
  append-only; anon/authenticated are denied; uint256 amounts round-trip
  exactly; the rollup equals the raw aggregate.

## Reorgs and finality

- Beam and Datastreams deliver confirmed data by default and are stored as
  `confirmed`. With `is_zerolag` set, set `ALLIUM_BEAM_ZEROLAG=1` and events
  are stored as `observed`.
- The Realtime API serves from the chain tip, so backfill rows start as
  `observed`. Reconciliation promotes a row to `finalized` once it is older
  than 3 h and still returned in the same block. 3 h exceeds Allium's
  documented confirmation depth on every chain listed in guides/finality.
- Allium corrects reorgs by replacement:
  - The same event in a new block becomes `reorg_replaced`.
  - An event the provider no longer returns, inside a **fully paginated**
    window past finality, is marked `reorged` by reconciliation.
  - Rows are never deleted. Reorged rows are excluded from `onchain_hourly`.

## Security controls

- **Secrets:** `ALLIUM_API_KEY` and `ALLIUM_BEAM_WEBHOOK_SECRET` are
  server-side only (no `NEXT_PUBLIC_`). They are registered in `lib/env.ts` and
  `.env.example`, and never logged. Log lines carry path and status only.
- **Webhook:**
  - Fails closed when the secret is unset or shorter than 32 characters.
  - Constant-time compare over the raw bytes, with a ±5 min timestamp window.
  - Nonce replay table. The nonce is claimed only after a successful write, so
    a redelivery after a store failure is processed, not dropped.
  - 1 MB body cap, 8 MB decoded cap, at most 500 records per delivery,
    `application/json` only.
  - Unusable records are dead-lettered with a 200, so they cannot cause
    infinite retries.
- **Database:**
  - All `onchain_*` tables have RLS enabled with no policies, and every
    privilege is revoked from anon and authenticated.
  - Functions are `execute` for service_role only, with a pinned `search_path`.
- **Public page privacy:** `/onchain` is public.
  - User-wallet events leave the server truncated, with no explorer link and
    never a `user_id`.
  - Public search covers FurlPay-owned (treasury/watch) activity only, so an
    address lookup cannot reveal whether a wallet belongs to a FurlPay user.
  - Operators get full detail through `isOperator()` (same rules as
    `requireRole("admin")`, without logging a denial for non-admins).
- **Input:** search accepts only a strict hash, address, chain or symbol shape
  and turns it into an `eq` filter (no LIKE, no user-supplied operators).
  Cursors are numeric ids.
- **Rate limits:**

| Endpoint | Limit |
|---|---|
| webhook | 6000/min/IP (flood shield before HMAC) |
| live | 120/min |
| stream | 20/min |
| search | 30/min |
| tx | 60/min |
| ops sync | 4/min/admin |

  Rate limits fail open while Upstash is over quota. The shared 2 s snapshot
  and 60 s dashboard cache bound database load independently of the limiter.

## API routes

| Route | Class | Purpose |
|---|---|---|
| `POST /api/webhooks/allium` | WEBHOOK_VERIFIED | Beam sink |
| `GET /api/onchain/live` | PUBLIC_INTENTIONAL | feed, freshness, pipeline state |
| `GET /api/onchain/stream` | PUBLIC_INTENTIONAL | SSE change notifications (no data) |
| `GET /api/onchain/search` | PUBLIC_INTENTIONAL | hash, address, chain or asset search |
| `GET /api/onchain/tx?key=` | PUBLIC_INTENTIONAL | transaction inspector |
| `POST /api/ops/onchain/sync` | ADMIN_ONLY | backfill or reconcile now (no KV dependency) |
| `GET /api/cron/onchain-reconcile` | INTERNAL_ONLY | daily 06:40 UTC, 26 h lookback |
| `GET /api/onchain` | PUBLIC_INTENTIONAL | existing dashboard aggregates |

## Live state (the badge)

The server-side `pipelineState()` computes the badge, which is never "live"
just because the page is open:

| State | Meaning |
|---|---|
| `not_configured` | No Allium key and no Beam secret |
| `offline` | No store, or the store or migration is unavailable |
| `stale` | No ingest and no successful reconciliation in 26 h, or never |
| `degraded` | Dead letters in the last 24 h, or the last reconciliation was partial or failed |
| `live` | Recent ingest or a successful reconciliation, and none of the above |

The browser adds `reconnecting` while its SSE link is down. Hovering the badge
shows:
- the last chain event time
- the ingest lag (`observed_at − block_timestamp` of the newest event)
- the number of stored events
- the number of dead letters
- the last reconciliation
- the link state

## Failure handling

| Failure | Behaviour |
|---|---|
| Allium 429 or 5xx | 3 attempts with exponential backoff and jitter, honouring `Retry-After` |
| Allium 401 or 403 | Not retried; the run stops |
| Allium timeout | 15 s per call |
| Store down during webhook | 503; nonce not claimed; the provider's redelivery is processed |
| Malformed or unknown record | `onchain_dead_letters` (deduplicated by payload hash); 200 |
| Reconciliation over budget | Run recorded as `partial`, with which pairs were skipped |
| KV down | Cron runner lock unavailable, so the daily cron skips (existing runner behaviour); use `POST /api/ops/onchain/sync` |

## Not built, deliberately

- **Entity labels** (Binance, Coinbase…): `onchain_entity_labels` exists, but
  only provider-verified labels may fill it. The Realtime API's per-transaction
  `labels` are stored in metadata, and they are not entity attribution. Rows
  show "Unknown address" until a verified entity source is connected.
- **Cross-chain correlation:** not inferred. The Wallet Transactions API marks
  `asset_bridge` activities, stored as `activity_type = bridge`. Linking source
  and destination transactions needs a provider correlation id, which these
  endpoints do not return.
- **Kafka/PubSub consumers:** they need a long-running worker outside Vercel.
- **High-rate rollups:** rollups are rebuilt per touched hour under one
  advisory lock. That measured about 3,600 events/s with 20 concurrent callers
  on a local PG18. At sustained rates well beyond that, move the rebuild to a
  debounced job.

## Production setup (remaining)

1. **Apply `supabase/migrations/0032_onchain_ingestion.sql`** to production.
   It is numbered 0032 because 0031 is taken on
   `security/full-audit-2026-10-06`.
2. **Allium account:** create an API key, then set `ALLIUM_API_KEY` in Vercel
   Production.
3. **Beam signing key:**
   - Generate a key of at least 32 random bytes.
   - Store it as an Allium organization secret.
   - Set the same value as `ALLIUM_BEAM_WEBHOOK_SECRET` in Vercel.
4. **Beam pipeline**, one per chain:
   - **Source:** `{chain, entity: "erc20_token_transfer"}`.
   - **Transforms:** `redis_set_filter` on `this.to_address`, and one on
     `this.from_address`, with the tracked addresses as the set values.
   - **v8 transform:** stamps the chain into the signed record:
     ```js
     function transform(r) { r.chain = "base"; return r; }
     ```
   - **Sink:** `{type: "webhook", url: "https://furlpay.com/api/webhooks/allium", hash_key: "<secret name>"}`.
5. **Tracked addresses:** verified linked wallets are automatic. Also set
   `TREASURY_ADDRESS_<CHAIN>` and/or `ONCHAIN_WATCH_ADDRESSES`. Keep the Beam
   filter sets in sync with these.
6. **Initial backfill:** `POST /api/ops/onchain/sync`
   `{"kind":"backfill","lookbackHours":720}` as admin, then check
   `onchain_reconciliation_runs`.
7. **Upgrade Upstash:** this restores rate limiting and the cron runner lock
   (KV is over quota as of 2026-10-02).

## Runbook

**Dead letters rising.** Inspect the latest dead letters:

```sql
select reason, payload from onchain_dead_letters where resolved_at is null order by received_at desc limit 20;
```

A new field shape means Allium changed the record; update `normalizeBeamRecord`
and replay the payloads.

**`reconciliation_required` rows.** Compare `ledger_ref` with the transaction
on the explorer. The ledger is authoritative; correct it through the normal
financial process, never from this table.

**Badge stale.** Check the Beam pipeline's deployment metrics in Allium, then
run `POST /api/ops/onchain/sync {"kind":"reconcile","lookbackHours":26}`.

**Suspected key leak.**
1. Rotate the Allium API key.
2. Rotate the Beam secret: update the org secret, set
   `ALLIUM_BEAM_WEBHOOK_SECRET`, redeploy the pipeline, then redeploy the app.
3. Old signatures fail immediately.

## Tokenized assets (RWA) snapshots

**Licensing rule.** Allium exports are licensed data. Allium ToS §1.3(iii) and §1.11 forbid distributing Allium's datasets or Output beyond what the order authorizes.

**Where the data lives.**
- Table: `rwa_asset_snapshots` (migration 0033), one row per (snapshot_date, chain, product_name, token_symbol).
- RLS is on, the table is service_role only, and the `rwa_assets_latest` view is `security_invoker`.
- Aggregation runs in `rwa_summary(date)` and `rwa_search(...)`. Both take an optional snapshot date and default to the latest.

**Where it is shown, admin only.**
- `/analytics/rwa`, behind the /analytics layout gate.
- The "Tokenized Assets" section of `/onchain`. The server renders it only when `isOperator()` is true, so for everyone else it is not in the page payload at all.
- Data comes from `GET /api/ops/rwa` (ADMIN_ONLY, 60/min/admin). There is no public endpoint, no static file and no export.
- The CSV must never be committed (it is in `.gitignore`), copied into `public/`, or bundled.

**Loading a new export.**

```
node scripts/data/import-rwa-snapshot.mjs "<CSV_PATH>" --as-of YYYY-MM-DD           # dry run: validates, prints totals
node scripts/data/import-rwa-snapshot.mjs "<CSV_PATH>" --as-of YYYY-MM-DD --apply   # writes (DATABASE_URL = session pooler, port 5432)
```

- **All or nothing:** every row is validated first. Any invalid row (bad chain, class, type, money, duplicate key, wrong header) aborts the run with nothing written. The write is one transaction.
- **Exact money:** amounts stay decimal strings end to end. Exponent notation is expanded by moving the decimal point, never via a float. The column holds 8 decimals, and the importer checks the stored total equals the file total exactly.
- **Idempotent:** re-importing the same file for the same date changes 0 rows.
- **Different file, same date:** refused and rolled back, so a snapshot always equals one file.
- **History is kept:** a new `--as-of` adds a snapshot and never touches earlier ones. The UI shows the latest by default, and a snapshot picker appears once there are two or more.

**First production load (2026-10-06 export).** The expected dry-run output is 33,338 rows, 7,770 non-zero, 25,568 zero, total `32090414743.38735443`, 344 products, 101 issuers and 26 chains. Afterwards, check:

```sql
select count(*), count(*) filter (where market_cap_usd > 0), sum(market_cap_usd),
       count(distinct product_name), count(distinct issuer_name), count(distinct chain)
  from rwa_asset_snapshots where snapshot_date = '2026-10-06';
-- expect 33338 | 7770 | 32090414743.38735443 | 344 | 101 | 26
select token_symbol, count(*), sum(market_cap_usd) from rwa_asset_snapshots
 where snapshot_date = '2026-10-06' and token_symbol in ('BUIDL','XAUT','USYC','USDY','PAXG') group by 1 order by 3 desc;
-- expect XAUT 1 2810893623.83580100 | USYC 4 2405568767.59929841 | BUIDL 8 2245797970.17764900
--        USDY 9 2201749543.42125579 | PAXG 2 1803198641.18916658
```

**Proof.** The import, aggregation, multi-snapshot and permission behaviour were verified on PostgreSQL 18 with the real export, using a local harness kept outside the repo.
