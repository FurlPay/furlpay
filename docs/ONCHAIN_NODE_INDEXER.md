# Direct-to-node indexing and the USDC Network panel

Status: code complete, verified against real mainnet nodes and a real
PostgreSQL 18. **Not migrated or deployed anywhere.** Nothing in this document
is applied automatically.

## What it is

Two indexers read each chain's **own node** over standard JSON-RPC (no data
provider in between) and share one storage path:

| Indexer | Scope | Code | Storage |
|---|---|---|---|
| Tracked wallets | Every transfer touching an address FurlPay tracks (linked user wallets, `TREASURY_ADDRESS_<CHAIN>`, `ONCHAIN_WATCH_ADDRESSES`, the operator registry). Unfinalized tip included; idempotent. | `lib/onchain/nodeIndexer.ts` (EVM), `lib/onchain/solanaNodeIndexer.ts` (Solana) | `onchain_events` via `onchain_ingest` (0032) |
| Network asset index | **Every** native-USDC Transfer on the chain, aggregated per UTC minute, **finalized blocks only**, committed exactly once with exact supply reconciliation. | `lib/onchain/assetIndexer.ts` | `onchain_asset_*`, `onchain_supply_snapshots` (0034) |

The `/onchain` **USDC Network** panel combines them with a live node read
(`lib/onchain/usdcNetwork.ts`, refreshed every 10 s): head, exact supply and
the last 1/5 minutes of USDC activity.

### Data coverage

| Chain | Network-wide activity | Supply | Tracked wallets |
|---|---|---|---|
| Ethereum | yes (live window + finalized history) | exact, per block | yes |
| Base | yes | exact | yes |
| Arbitrum One | yes | exact | yes |
| Polygon PoS | yes | exact | yes |
| Solana | **no** — enumerating every transfer of a mint needs a Geyser stream; shown as n/a, never 0 | exact (`getTokenSupply`, snapshot ≤ 1/min) | yes: wallets **and all their token accounts** (ATA, extra accounts, Token-2022), including accounts closed in the last 7 days |

Assets are identified by **contract**, never by symbol: the bridged USDC.e
contracts on Polygon (`0x2791…`) and Arbitrum (`0xff97…`) report
`symbol() = "USDC"` on-chain. USDC.e is defined in `lib/onchain/assets.ts`
with `indexed: false` and shown in the UI as explicitly excluded. Indexing it
later is a registry change.

## Guarantees and how they are enforced

| Guarantee | Mechanism |
|---|---|
| A block range is aggregated exactly once | `onchain_asset_commit` compare-and-sets the cursor in the same transaction as the aggregates; a second worker gets `stale_cursor` and writes nothing |
| No gaps | the range must start at `cursor + 1` or it is refused (`block_gap` issue) |
| No silent fork | the range's parent hash must equal the hash stored at the cursor (`reorg_inconsistency`) |
| No reorg corrections needed | finalized blocks only (node's own `finalized` tag) |
| Supply is right | `supply(prev) + minted − burned = supply(now)` exactly, per range (`supply_mismatch`) |
| No impossible values | negative supply / amounts, mint or burn totals without events are refused |
| Endpoint is the right chain | `eth_chainId` vs the registry; Solana by genesis hash, pinned in the cursor |
| Provider agreement (optional) | `<CHAIN>_RPC_URL_SECONDARY`: last block hash + supply must match or the range is not committed (`provider_disagreement`) |
| Duplicates | `(tx, logIndex)` counted once per range and reported (`duplicate_event`); wallet events are unique on `event_key` |
| Provenance | `onchain_asset_commits` (range, hash, time, totals, supply, provider, duration) and `onchain_supply_snapshots` are append-only (trigger) |
| Crash safety | nothing moves the cursor except a successful commit; a crashed pass is simply re-read |

Problems are recorded in `onchain_integrity_issues` (one open row per
chain/asset/kind/block, occurrences counted) and surface on the panel; a chain
with a serious open issue is shown **DEGRADED**.

Chain states on the panel: `LIVE`, `INDEXING` (behind finalized > 10 min),
`DEGRADED` (stale head, failing indexer, not indexed, open issue, no store),
`UNAVAILABLE` (node read failed — reason shown), `NOT CONFIGURED` (no RPC URL).

## Production requirements

### Environment (Vercel project `web`)

| Variable | Purpose |
|---|---|
| `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `POLYGON_RPC_URL`, `SOLANA_RPC_URL` | The nodes. Missing → that chain shows NOT CONFIGURED. |
| `ONCHAIN_NODE_CHAINS` | Opt-in list for both indexers, e.g. `ethereum,base,arbitrum,polygon,solana` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | The store (already used by the app). Without it: live reads only, every chain DEGRADED with the reason. |
| `FURLPAY_CRON_SECRET` | Authenticates the worker's calls to `/api/cron/onchain-node` |
| `<CHAIN>_RPC_URL_SECONDARY` (optional) | Independent verification provider |
| `ONCHAIN_WATCH_ADDRESSES` / `TREASURY_ADDRESS_<CHAIN>` (optional) | Env-defined tracked addresses; the operator registry (`POST /api/ops/onchain/wallets`) is the chain-agnostic alternative |

### RPC / node requirements

- EVM: `eth_chainId`, `eth_getBlockByNumber` (incl. `finalized`), `eth_getLogs`
  with an address filter, `eth_call` at **historical finalized blocks**,
  JSON-RPC **batch** requests. Free hosted endpoints frequently refuse
  `eth_call` a few dozen blocks back ("archive requests require a personal
  token", "missing trie node"; verified 2026-10-07). After downtime the
  indexer then commits ranges without supply (reconciliation skipped and
  visible as such). Use your own full node (or a paid archive endpoint).
- Arbitrum's node returns `blockTimestamp: "0x0"` on logs; the indexers read
  the header instead (handled).
- Solana: `getGenesisHash`, `getSlot`, `getTokenSupply`,
  `getTokenAccountsByOwner` (PublicNode blocks this one),
  `getSignaturesForAddress`, `getTransaction` (jsonParsed). Public mainnet-beta
  allows 10 `getTransaction` / 10 s and sends `Retry-After`, which is honoured.

### Long-running worker

Vercel Cron fires at most daily on this plan; real time needs the tail worker,
**outside** the web deployment, next to (or with access to) the nodes:

```sh
FURLPAY_BASE_URL=https://furlpay.com \
FURLPAY_CRON_SECRET=… \
ONCHAIN_TAIL_CHAINS=ethereum,base,arbitrum,polygon,solana \
ETHEREUM_RPC_URL=… BASE_RPC_URL=… ARBITRUM_RPC_URL=… POLYGON_RPC_URL=… SOLANA_RPC_URL=… \
node scripts/onchain/node-tail.mjs
```

It holds no state (cursors live in Postgres), so run it under any supervisor
(systemd `Restart=always`, a container with a restart policy, pm2). Two copies
cannot double-count. Logs are JSON lines with a stable `event`:
`indexer_started`, `block_detected`, `block_indexed`,
`indexer_checkpoint_saved`, `indexer_reorg_detected`, `rpc_unavailable`,
`indexer_error`, `indexer_recovered`, `integrity_issue`. Server-side the app
also logs `range_split`, `rpc_rate_limited`, `solana_slot_indexed`. URLs and
secrets are scrubbed from every log line.

The first pass on a chain **anchors at the finalized block**; history starts
there (no implicit backfill).

## Migration

Migrations `0032_onchain_ingestion.sql` and `0034_onchain_asset_index.sql`
(0034 depends on 0032). Both are idempotent (`if not exists`,
`create or replace`), contain no `concurrently` statements, and are safe to
re-run. **Do not apply to production without the verification below.**

1. Verify against a throwaway database (must end in `_test`):

   ```sh
   DATABASE_URL=postgres://…/onchain_test node scripts/db/verify-onchain-ingest.mjs
   DATABASE_URL=postgres://…/onchain_test node scripts/db/verify-onchain-asset-index.mjs
   # a database that already applied an earlier 0032 (fresh _test DB per run):
   DATABASE_URL=postgres://…/onchain_up_test node scripts/db/verify-onchain-upgrade.mjs 2e5f3657
   DATABASE_URL=postgres://…/onchain_up_test node scripts/db/verify-onchain-upgrade.mjs 461ff1bb
   ```

   `0032` was extended in place on this branch; its upgrade block brings a
   database at either committed version (2e5f3657, 461ff1bb) to exactly the
   schema a fresh install produces (columns, constraints, indexes, function
   signatures — compared object by object) and drops the old function
   signatures so no call becomes ambiguous.

2. Staging, then production, with the Supabase CLI (tracks history):

   ```sh
   npx supabase db push --db-url "$DATABASE_URL"
   ```

   or one file at a time, stopping on the first error:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0032_onchain_ingestion.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/0034_onchain_asset_index.sql
   ```

   Note: `0031` exists on another branch (security audit). `db push` applies
   by version; if 0031 lands later, push with `--include-all`.

3. Verify (read-only):

   ```sql
   select to_regclass('public.onchain_asset_commits') is not null as tables_ok;
   select proname from pg_proc where proname in ('onchain_asset_commit','onchain_asset_anchor','onchain_asset_series','onchain_supply_series','onchain_indexer_touch','onchain_record_issue');
   select relname, relrowsecurity from pg_class where relname like 'onchain_%' and relkind = 'r';  -- all true
   select has_table_privilege('anon', 'onchain_asset_minutes', 'select');                          -- false
   ```

4. After the worker runs for a few minutes:

   ```sql
   select chain, asset, last_block, last_block_time, updated_at from onchain_asset_cursors;
   select chain, count(*), bool_and(reconciled) from onchain_asset_commits group by 1;
   select * from onchain_asset_gaps('usdc');                       -- expect no rows
   select kind, chain, block, detail from onchain_integrity_issues where resolved_at is null;
   ```

## Verifying the data is real

- `apps/web/src/lib/onchain/__tests__/assetIndexer.live.spec.ts` (with
  `ONCHAIN_LIVE_E2E=1` and a `_test` `DATABASE_URL`): indexes real mainnet
  USDC on four chains into Postgres; every range must reconcile exactly; the
  stored minute buckets must equal an **independent provider's** logs for the
  same blocks; the history API must reproduce the stored totals; the
  dashboard components render that real response.
- `usdcNetwork.live.spec.ts`: the live panel numbers vs a second provider.
- `solanaNodeIndexer.live.spec.ts`: Solana wallet indexing into Postgres, each
  row checked against the wallet's balance change reported by the node.

## Runbook

| Symptom | Meaning | Action |
|---|---|---|
| `supply_mismatch` | supply did not move by exactly minted − burned | Compare with a second provider (`<CHAIN>_RPC_URL_SECONDARY`); suspect the node. The range stays committed and flagged. |
| `reorg_inconsistency` / `provider_disagreement` | the node now reports a different finalized history | Stop the worker for that chain, check the node's sync status; do not move the cursor by hand. |
| `block_gap` / `checkpoint_regression` | a worker tried to skip or rewind | Check for a misconfigured second deployment; the store refused it, nothing is wrong in the data. |
| `INDEXING` for long | catching up after downtime | Normal; watch `onchain_asset_cursors.last_block_time` advance. |
| ranges with `reconciled = null` | the node refused historical `eth_call` | Use a full/archive node. |
| Solana `more than 10000 signatures since slot` | backlog beyond the page budget | `POST /api/ops/onchain/sync {"kind":"node","chain":"solana","fromBlock":<slot>}` |

## Not implemented (follow-ups)

Bitcoin, TRON, network-wide Solana transfer streaming (Geyser), the country
flow map, chain/token/address detail pages, CSV export, feature flags.
