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

-- ── Index queries for /analytics/rwa (admin) ────────────────────────────────
-- Aggregation happens here so the app never pulls 33k rows to group them.

-- Whole-snapshot summary: totals, by class/type/chain/issuer, and the top
-- products aggregated across chains.
create or replace function rwa_summary(p_snapshot date default null)
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with s as (
    select * from rwa_asset_snapshots
     where snapshot_date = coalesce(p_snapshot, (select max(snapshot_date) from rwa_asset_snapshots))
  ),
  prod as (
    select product_name, min(issuer_name) as issuer_name, min(asset_class) as asset_class, min(asset_type) as asset_type,
           sum(market_cap_usd) as market_cap_usd,
           count(*) as deployments,
           count(*) filter (where market_cap_usd > 0) as live_deployments,
           array_agg(distinct chain order by chain) filter (where market_cap_usd > 0) as chains,
           (array_agg(token_symbol order by market_cap_usd desc))[1] as top_symbol
      from s group by product_name
  )
  select jsonb_build_object(
    'snapshot_date', (select max(snapshot_date) from s),
    'snapshots', (select coalesce(jsonb_agg(d order by d desc), '[]'::jsonb) from (select distinct snapshot_date d from rwa_asset_snapshots) x),
    'total_usd', (select coalesce(sum(market_cap_usd), 0) from s),
    'deployments', (select count(*) from s),
    'live_deployments', (select count(*) from s where market_cap_usd > 0),
    'products', (select count(distinct product_name) from s),
    'issuers', (select count(distinct issuer_name) from s),
    'chains', (select count(distinct chain) from s),
    'by_class', (select coalesce(jsonb_agg(x order by x.market_cap_usd desc), '[]'::jsonb) from (
        select asset_class, sum(market_cap_usd) market_cap_usd, count(*) deployments, count(distinct product_name) products from s group by 1) x),
    'by_type', (select coalesce(jsonb_agg(x order by x.market_cap_usd desc), '[]'::jsonb) from (
        select asset_class, asset_type, sum(market_cap_usd) market_cap_usd, count(*) deployments from s group by 1, 2) x),
    'by_chain', (select coalesce(jsonb_agg(x order by x.market_cap_usd desc), '[]'::jsonb) from (
        select chain, sum(market_cap_usd) market_cap_usd, count(*) deployments, count(*) filter (where market_cap_usd > 0) live from s group by 1) x),
    'by_issuer', (select coalesce(jsonb_agg(x order by x.market_cap_usd desc), '[]'::jsonb) from (
        select issuer_name, sum(market_cap_usd) market_cap_usd, count(distinct product_name) products from s group by 1 order by 2 desc limit 25) x),
    'top_products', (select coalesce(jsonb_agg(to_jsonb(p) order by p.market_cap_usd desc), '[]'::jsonb) from (select * from prod order by market_cap_usd desc limit 25) p)
  )
$$;

-- Filtered, sorted page of deployments. Every filter is a bound parameter;
-- text search is a case-insensitive substring over product/symbol/issuer.
create or replace function rwa_search(
  p_q text default null, p_asset_class text default null, p_chain text default null, p_issuer text default null,
  p_min_usd numeric default 0, p_sort text default 'market_cap', p_limit integer default 50, p_offset integer default 0,
  p_snapshot date default null
)
returns jsonb
language sql stable
set search_path = public, pg_catalog
as $$
  with s as (
    select * from rwa_asset_snapshots
     where snapshot_date = coalesce(p_snapshot, (select max(snapshot_date) from rwa_asset_snapshots))
       and (p_asset_class is null or asset_class = p_asset_class)
       and (p_chain is null or chain = p_chain)
       and (p_issuer is null or issuer_name = p_issuer)
       and market_cap_usd >= greatest(coalesce(p_min_usd, 0), 0)
       and (p_q is null or length(p_q) = 0
            or product_name ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or token_symbol ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            or issuer_name ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from s),
    'total_usd', (select coalesce(sum(market_cap_usd), 0) from s),
    'rows', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
      select product_name, token_symbol, chain, issuer_name, asset_class, asset_type, market_cap_usd
        from s
       order by case when p_sort = 'name' then null else market_cap_usd end desc nulls last,
                case when p_sort = 'name' then product_name end asc,
                product_name, chain, token_symbol
       limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r)
  )
$$;

alter table rwa_asset_snapshots enable row level security;
revoke all on table rwa_asset_snapshots from public, anon, authenticated;
grant select, insert, update on table rwa_asset_snapshots to service_role;
revoke all on table rwa_assets_latest from public, anon, authenticated;
grant select on table rwa_assets_latest to service_role;
revoke all on function rwa_summary(date) from public, anon, authenticated;
grant execute on function rwa_summary(date) to service_role;
revoke all on function rwa_search(text, text, text, text, numeric, text, integer, integer, date) from public, anon, authenticated;
grant execute on function rwa_search(text, text, text, text, numeric, text, integer, integer, date) to service_role;
