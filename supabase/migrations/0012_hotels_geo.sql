-- ---------------------------------------------------------------------------
-- Global hotel geography (OpenStreetMap).
--
-- WHAT THIS TABLE IS. The persistent answer to "where are the hotels?", for the
-- whole world. It is populated from OpenStreetMap via Overpass and it is the
-- ONLY hotel dataset the map draws from.
--
-- WHAT IT IS DELIBERATELY NOT. It holds no prices, no availability, and no
-- supplier content. Those come from Duffel at the moment a user asks for them
-- and are never persisted here, because a stored rate is a stale rate and a
-- stale rate shown as current is a wrong price. The one supplier value that may
-- land here is `duffel_accommodation_id` — an identifier, not content — and
-- only once a HIGH-confidence match has been established.
--
-- WHY OVERPASS IS NOT QUERIED PER MAP LOAD. Overpass is a free, shared service
-- with no SLA and a polite-use policy. Querying it on every viewport change
-- would be both abusive and slow. Ingest is a batch job; the map reads Postgres.
--
-- LICENCE. OpenStreetMap data is ODbL. Attribution to OpenStreetMap
-- contributors is required wherever this data is displayed, and is rendered by
-- the map's attribution control. A derived database distributed publicly
-- carries the same licence — that obligation travels with this table.
-- ---------------------------------------------------------------------------

create extension if not exists postgis;

create table hotels_geo (
  -- The OSM element id ("osm_n123", "osm_w456") IS the natural key: unique,
  -- stable, and already how every other layer refers to a hotel. A surrogate
  -- uuid would add a second identity for the same row with nothing to say.
  osm_id        text primary key check (osm_id ~ '^osm_[nwr][0-9]+$'),

  name          text not null check (length(btrim(name)) between 1 and 200),

  -- Kept alongside the geography column, not derived from it. The raw pair is
  -- what the API returns and what the client plots; `location` exists for the
  -- index. Both are constrained so neither can drift into an impossible value.
  latitude      double precision not null check (latitude between -90 and 90),
  longitude     double precision not null check (longitude between -180 and 180),

  -- geography(Point, 4326) rather than geometry: distance and radius queries
  -- return metres on the spheroid without the caller picking a projection. A
  -- hotel map is global, so a planar projection would be wrong somewhere.
  location      geography(Point, 4326) not null,

  city          text check (city is null or length(city) <= 120),
  -- ISO 3166-1 alpha-2, as OSM's addr:country records it.
  country_code  text check (country_code is null or country_code ~ '^[A-Za-z]{2}$'),

  -- OSM `stars` is free text ("5", "5S", "4.5"); the ingest parses it and stores
  -- only a value it could actually parse. NULL means "not recorded", which is
  -- different from — and must never be rendered as — zero stars.
  stars         numeric(2,1) check (stars is null or stars between 1 and 5),
  -- OSM `stars=5S` (superior), the tier above plain 5.
  stars_superior boolean not null default false,

  -- tourism=hotel | resort | guest_house | hostel | apartment
  hotel_type    text not null default 'hotel' check (length(hotel_type) <= 40),
  brand         text check (brand is null or length(brand) <= 120),

  -- H3 resolution 9 (~174m edge). Indexed so candidate lookup for
  -- deduplication and clustering is a hash probe rather than a scan.
  h3_cell       text not null check (h3_cell ~ '^[0-9a-f]{15}$'),

  -- Derived categories (["ultra_luxury","heritage_castles"]). Recomputed by the
  -- ingest from tags, never written by a request handler.
  categories    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(categories) = 'array'
                       and jsonb_array_length(categories) <= 16),

  -- FurlPay L-Score, 0-100, computed WITHOUT a live rating (none can be stored).
  -- Nullable because a property with no stars, brand or amenity tags has no
  -- honest score — better absent than zero, which would sort as "worst".
  l_score       numeric(4,1) check (l_score is null or l_score between 0 and 100),

  -- Raw OSM tags, so a classification change can be recomputed from the
  -- original evidence rather than requiring a full re-crawl. Capped so one
  -- pathological element cannot bloat the table.
  tags          jsonb not null default '{}'::jsonb
                check (jsonb_typeof(tags) = 'object' and pg_column_size(tags) <= 8192),

  -- Established supplier match. An ID only — never supplier content. NULL until
  -- a HIGH-confidence match exists; anything weaker is not durable knowledge.
  duffel_accommodation_id text
                check (duffel_accommodation_id is null
                       or length(duffel_accommodation_id) <= 64),
  -- When the match was made, so it can be re-verified rather than trusted
  -- forever.
  duffel_matched_at timestamptz,

  -- Provenance of the row itself.
  osm_version   integer,
  ingested_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The viewport query. Every map load is "hotels inside this box", which on a
-- geography column is an index-assisted ST_Intersects / ST_DWithin.
create index hotels_geo_location_gist on hotels_geo using gist (location);

-- Cluster and dedupe lookups probe by cell.
create index hotels_geo_h3_cell on hotels_geo (h3_cell);

-- Filter pills and destination search.
create index hotels_geo_country on hotels_geo (country_code);
create index hotels_geo_city on hotels_geo (city);

-- "Show me only 5-star" at low zoom: a partial index, because the filtered
-- views are the ones that need to stay fast and unrated hotels are the bulk.
create index hotels_geo_stars on hotels_geo (stars desc nulls last)
  where stars is not null;

-- Category pills are contains-queries against the jsonb array.
create index hotels_geo_categories on hotels_geo using gin (categories);

-- Ranking the best properties in a viewport.
create index hotels_geo_lscore on hotels_geo (l_score desc nulls last)
  where l_score is not null;

-- Name search. trigram so "oberoi" matches "The Oberoi Bengaluru" without a
-- leading-wildcard scan.
create extension if not exists pg_trgm;
create index hotels_geo_name_trgm on hotels_geo using gin (name gin_trgm_ops);

-- Keep `location` in agreement with the lat/lng pair. Doing this in a trigger
-- rather than trusting the writer means an ingest bug cannot store a point that
-- disagrees with its own coordinates — the index and the payload can never
-- diverge.
create or replace function hotels_geo_sync_location()
returns trigger
language plpgsql
as $$
begin
  new.location := ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;

create trigger hotels_geo_sync_location_trg
  before insert or update of latitude, longitude on hotels_geo
  for each row execute function hotels_geo_sync_location();

alter table hotels_geo enable row level security; -- service-role only, like every table

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop table if exists hotels_geo;
--   drop function if exists hotels_geo_sync_location();
--   -- postgis / pg_trgm are left installed; other work may depend on them.
-- No other table references hotels_geo, so this is clean and touches no
-- balances, orders or user data.
-- ---------------------------------------------------------------------------
