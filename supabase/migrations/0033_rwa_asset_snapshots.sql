-- ===========================================================================
-- 0033 — Tokenized real-world-asset (RWA) market snapshots.
--
-- Point-in-time market data per (product, token, chain): issuer, asset class,
-- asset type, market cap in USD. Loaded from an export of Allium's tokenized
-- assets dataset by scripts/data/import-rwa-snapshot.mjs (idempotent upsert).
--
-- REFERENCE DATA, not financial state: nothing here is a FurlPay balance,
-- holding or price used for money movement.
--
-- One row per (snapshot_date, chain, product_name, token_symbol), so a
-- re-import of the same file is a no-op and a later export becomes a new
-- snapshot (history is kept; rwa_assets_latest reads the newest).
-- token_symbol is '' (not NULL) when the source has none, so it can be part
-- of the primary key.
--
-- ACCESS: service_role only (RLS on, no policies). The data comes from a
-- licensed provider export; it is not exposed to anon/authenticated.
-- ===========================================================================

create table if not exists rwa_asset_snapshots (
  snapshot_date  date not null,
  chain          text not null check (chain ~ '^[a-z0-9_-]{2,32}$'),
  product_name   text not null check (length(product_name) between 1 and 200),
  token_symbol   text not null default '' check (length(token_symbol) <= 64),
  issuer_name    text not null check (length(issuer_name) between 1 and 200),
  asset_class    text not null check (asset_class ~ '^[a-z_]{2,40}$'),
  asset_type     text not null check (asset_type ~ '^[a-z0-9_]{2,60}$'),
  -- Exact decimal as exported (the source column is a float; stored as the
  -- exported decimal string, never re-rounded).
  market_cap_usd numeric(30, 8) not null check (market_cap_usd >= 0),
  source         text not null,
  imported_at    timestamptz not null default now(),
  primary key (snapshot_date, chain, product_name, token_symbol)
);

create index if not exists rwa_asset_snapshots_class_idx  on rwa_asset_snapshots (snapshot_date desc, asset_class);
create index if not exists rwa_asset_snapshots_issuer_idx on rwa_asset_snapshots (snapshot_date desc, issuer_name);
create index if not exists rwa_asset_snapshots_mcap_idx   on rwa_asset_snapshots (snapshot_date desc, market_cap_usd desc);

-- Newest snapshot only. security_invoker: the view runs with the CALLER's
-- privileges, so it can never be a way around the table's RLS (PG15+; prod
-- is PG17).
create or replace view rwa_assets_latest with (security_invoker = true) as
  select * from rwa_asset_snapshots
   where snapshot_date = (select max(snapshot_date) from rwa_asset_snapshots);

alter table rwa_asset_snapshots enable row level security;
revoke all on table rwa_asset_snapshots from public, anon, authenticated;
grant select, insert, update on table rwa_asset_snapshots to service_role;
revoke all on table rwa_assets_latest from public, anon, authenticated;
grant select on table rwa_assets_latest to service_role;
