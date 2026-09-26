-- ---------------------------------------------------------------------------
-- Migration 0015: universal_hotels — the global lodging registry behind the
-- vector-tile map.
--
-- NUMBERED 0015, NOT 0014. The blueprint called this 0014; that number is
-- already taken by 0014_financial_transactions.sql. Two migrations sharing an
-- ordinal is how a deploy applies one of them and silently skips the other.
--
-- WHY A NEW TABLE RATHER THAN EXTENDING hotels_geo (0012)
-- hotels_geo is keyed by `osm_id` and models OpenStreetMap's shape. This table
-- is source-agnostic: one row is one REAL-WORLD PROPERTY, carrying whichever
-- external ids happen to identify it (osm, google, trip, a PMS). That is the
-- difference between a mirror of one dataset and a registry that can merge
-- several, and merging is the entire point of the H3 consensus step.
--
-- 0012 and 0013 are untouched. Nothing is dropped, nothing is migrated off
-- them; they remain the per-source caches this registry consolidates FROM.
-- ---------------------------------------------------------------------------

create extension if not exists postgis;
create extension if not exists pg_trgm;

create table if not exists public.universal_hotels (
  id                  text primary key,
  name                text not null check (length(btrim(name)) between 1 and 300),

  -- Coordinates are stored as plain columns AND as a geography point. The
  -- columns are what the API returns; `location` is what the index and
  -- ST_AsMVTGeom read. The trigger below keeps them in agreement so an ingest
  -- bug cannot store a point that disagrees with its own lat/lng.
  latitude            double precision not null check (latitude between -90 and 90),
  longitude           double precision not null check (longitude between -180 and 180),
  location            geography(Point, 4326) not null,
  -- H3 resolution 9 (~174m edge). Matches lib/hotels/h3.ts DEDUPE_RESOLUTION;
  -- if that constant moves, this CHECK and every stored cell must move with it.
  h3_cell             text not null check (h3_cell ~ '^[0-9a-f]{15}$'),

  property_type       text not null default 'hotel'
                      check (property_type in ('hotel','resort','villa','private_room',
                                               'bed_and_breakfast','guest_house','hostel',
                                               'motel','extended_stay','other_accommodation')),
  stars               numeric(2,1) check (stars is null or stars between 1 and 5),
  -- Luxury score, 0-100. Nullable on purpose: "not scored yet" and "scored
  -- zero" are different facts, and the tile query orders by it NULLS LAST.
  l_score             numeric(4,1) check (l_score is null or l_score between 0 and 100),

  city                text check (length(city) <= 160),
  country_code        text not null check (country_code ~ '^[A-Z]{2}$'),

  -- Direct booking engine, when one has been identified from a property's own
  -- public booking widget. `pms_provider` is a closed set so a typo becomes an
  -- error rather than an orphan category.
  pms_provider        text check (pms_provider is null or pms_provider in
                                  ('synxis','travelclick','cloudbeds','mews',
                                   'siteminder','dedge','direct_custom')),
  direct_booking_url  text check (direct_booking_url is null or length(direct_booking_url) <= 1024),

  -- External identities. Each is the id this property carries in that source;
  -- none is required, and a row may accumulate more of them over time as the
  -- consensus step merges sources.
  trip_hotel_id       text check (trip_hotel_id is null or length(trip_hotel_id) <= 64),
  osm_id              text check (osm_id is null or length(osm_id) <= 64),
  google_place_id     text check (google_place_id is null or length(google_place_id) <= 256),
  overture_id         text check (overture_id is null or length(overture_id) <= 128),

  -- True only once a direct USDC settlement path has been VERIFIED for this
  -- property. Defaults false: an unverified property must never render as
  -- payable, because the badge is a promise to the traveller.
  x402_supported      boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Partial uniques rather than plain ones: many rows legitimately have NO
-- google_place_id, and a plain UNIQUE would treat every NULL as distinct while
-- still costing an index entry. These also make the ingest's "have I seen this
-- source id before" check a single index probe.
create unique index if not exists uq_universal_hotels_overture
  on public.universal_hotels (overture_id) where overture_id is not null;
create unique index if not exists uq_universal_hotels_google
  on public.universal_hotels (google_place_id) where google_place_id is not null;
create unique index if not exists uq_universal_hotels_osm
  on public.universal_hotels (osm_id) where osm_id is not null;
create unique index if not exists uq_universal_hotels_trip
  on public.universal_hotels (trip_hotel_id) where trip_hotel_id is not null;

-- Spatial index — what ST_TileEnvelope && location uses on every tile request.
create index if not exists idx_universal_hotels_location
  on public.universal_hotels using gist (location);
create index if not exists idx_universal_hotels_h3
  on public.universal_hotels (h3_cell);
create index if not exists idx_universal_hotels_country_city
  on public.universal_hotels (country_code, city);
create index if not exists idx_universal_hotels_name_trgm
  on public.universal_hotels using gin (name gin_trgm_ops);
create index if not exists idx_universal_hotels_pms
  on public.universal_hotels (pms_provider) where pms_provider is not null;

create or replace function universal_hotels_sync()
returns trigger
language plpgsql
as $$
begin
  new.location := ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;

create trigger universal_hotels_sync_trg
  before insert or update of latitude, longitude on public.universal_hotels
  for each row execute function universal_hotels_sync();

alter table public.universal_hotels enable row level security; -- service-role only

-- ---------------------------------------------------------------------------
-- hotels_mvt(z, x, y) -> base64 text
--
-- ST_AsMVT returns bytea, and this deployment reaches Postgres only through
-- PostgREST (lib/supabase.ts — there is no pg connection pool). PostgREST
-- renders bytea as a hex-escaped string, which is both larger than the tile
-- and awkward to decode. Returning base64 from inside Postgres instead means
-- the route does one Buffer.from(…, "base64") and serves the bytes.
--
-- Empty tiles return '' rather than NULL so the caller distinguishes "no
-- hotels here" (204) from "the function is missing" (migration not applied).
--
-- SECURITY DEFINER with a pinned search_path: the table is RLS-protected and
-- service-role only, but tiles are PUBLIC map data. This function is the one
-- sanctioned read, and it exposes only the columns listed below — never the
-- direct booking URL, which is commercial data rather than map data.
-- ---------------------------------------------------------------------------
create or replace function public.hotels_mvt(z integer, x integer, y integer)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select ST_TileEnvelope(z, x, y) as geom
  ),
  mvtgeom as (
    select
      h.id,
      h.name,
      h.property_type,
      h.stars,
      h.l_score,
      h.pms_provider,
      h.x402_supported,
      ST_AsMVTGeom(h.location::geometry, bounds.geom, 4096, 64, true) as geom
    from public.universal_hotels h, bounds
    where h.location::geometry && bounds.geom
    -- Densest metros hold far more than a tile can usefully draw. Ordering by
    -- score before the cut means the 2500 kept are the most interesting ones,
    -- not an arbitrary slice of whatever the index returned first.
    order by h.l_score desc nulls last, h.id
    limit 2500
  )
  select coalesce(encode(ST_AsMVT(mvtgeom.*, 'hotels', 4096, 'geom', 'id'), 'base64'), '')
  from mvtgeom;
$$;

revoke all on function public.hotels_mvt(integer, integer, integer) from public;
grant execute on function public.hotels_mvt(integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop trigger if exists universal_hotels_sync_trg on public.universal_hotels;
--   drop function if exists public.hotels_mvt(integer, integer, integer);
--   drop function if exists universal_hotels_sync();
--   drop table if exists public.universal_hotels;
--   -- postgis / pg_trgm are left installed; 0012 and 0013 depend on them.
-- ---------------------------------------------------------------------------
