-- ---------------------------------------------------------------------------
-- Google-sourced accommodation geography.
--
-- WHY THIS IS NOT hotels_geo. 0012 is the OpenStreetMap layer and says so in
-- its primary key: `osm_id ~ '^osm_[nwr][0-9]+$'`. A Google place ID
-- ("ChIJ_-wTYzdrXz4RrrhErFCw21o") cannot satisfy that check, and the table has
-- no column for one. Widening 0012 to accept both would give one table two
-- identity schemes and two provenance stories, which is exactly the ambiguity
-- the map's "one claim per pin" rule exists to prevent. Two sources, two
-- tables, merged at read time — the same shape the curated and OSM layers
-- already use.
--
-- ── WHAT MAY BE STORED, AND FOR HOW LONG ───────────────────────────────────
-- This is the constraint that shapes the whole table. Google's Places policy
-- exempts exactly ONE field from its caching restrictions:
--
--   "the place ID ... is exempt from the caching restrictions. You can
--    therefore store place ID values indefinitely."
--
-- Everything else Google returns is content under those restrictions. So the
-- columns here are split in two, and the split is enforced rather than
-- documented:
--
--   PERMANENT   place_id, and our own bookkeeping (when we saw it, which grid
--               cell found it, whether it is still worth asking about).
--
--   EXPIRING    name, coordinates, types, address, business status. Held to
--               make the map drawable without an upstream call per marker, and
--               stamped with `content_expires_at`. Past that moment a row is
--               not a fact any more and the read path must not serve it.
--
--   NEVER       rating, review count, photos, editorial summary, opening
--               hours, phone. These are fetched live, per property, at the
--               moment someone opens a card. There is deliberately nowhere in
--               this table to put them — a column would eventually get filled.
--
-- The 30-day window matches CURATED_STALE_DAYS in lib/hotels/curated.ts, which
-- already applies the identical rule to Google-derived coordinates on the
-- curated set. The two must not drift.
--
-- ── THE CONSEQUENCE OF NOT REFRESHING ──────────────────────────────────────
-- A row whose content has expired stops being served. The map gets sparser and
-- the status bar says so. That is the correct failure: coverage degrades
-- visibly, rather than the map quietly serving content we are no longer
-- permitted to hold.
-- ---------------------------------------------------------------------------

create extension if not exists postgis;
create extension if not exists pg_trgm;

create table places_accommodation (
  -- The one value with no expiry. Opaque, stable, and Google's own identity for
  -- the place, which makes it the deduplication key: the same hotel found in
  -- four overlapping grid cells is one row, not four.
  place_id      text primary key check (length(place_id) between 8 and 512),

  -- --- expiring content ----------------------------------------------------
  name          text not null check (length(btrim(name)) between 1 and 300),

  latitude      double precision not null check (latitude between -90 and 90),
  longitude     double precision not null check (longitude between -180 and 180),
  -- geography, not geometry, for the same reason as 0012: a global map has no
  -- single projection that is correct everywhere, and radius queries should
  -- come back in metres without the caller choosing one.
  location      geography(Point, 4326) not null,

  -- Google's own vocabulary, kept verbatim. Reclassification then never needs a
  -- re-crawl — the evidence for the decision is still here.
  google_types  jsonb not null default '[]'::jsonb
                check (jsonb_typeof(google_types) = 'array'
                       and jsonb_array_length(google_types) <= 32),
  primary_type  text check (primary_type is null or length(primary_type) <= 64),

  -- FurlPay's normalized taxonomy, derived ONLY from google_types. Never from
  -- the property's name: "Villa Rotana" is a hotel.
  property_type text not null default 'other_accommodation'
                -- Kept in step with PropertyType in lib/hotels/placesStore.ts.
                -- `private_room` is separate from `villa` on purpose: a room in
                -- someone's home and a whole cottage are not the same product,
                -- and collapsing them mislabelled 1,922 properties.
                check (property_type in (
                  'hotel','resort','villa','private_room','bed_and_breakfast',
                  'guest_house','hostel','motel','extended_stay',
                  'other_accommodation')),

  formatted_address text check (formatted_address is null or length(formatted_address) <= 500),
  city          text check (city is null or length(city) <= 160),
  region        text check (region is null or length(region) <= 160),
  country       text check (country is null or length(country) <= 120),
  country_code  text check (country_code is null or country_code ~ '^[A-Za-z]{2}$'),
  postal_code   text check (postal_code is null or length(postal_code) <= 32),

  -- OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY. A permanently closed
  -- hotel must never be presented as bookable, so this drives a read filter
  -- rather than sitting in the payload as decoration.
  business_status text check (business_status is null or length(business_status) <= 32),

  -- --- provenance and lifecycle --------------------------------------------
  -- Which discovery cell first returned it. Makes coverage auditable: "why is
  -- there nothing in Sharjah" is answerable by looking at what ran.
  discovered_in text check (discovered_in is null or length(discovered_in) <= 120),
  discovered_at timestamptz not null default now(),

  -- When the expiring columns above were last read from Google.
  content_fetched_at timestamptz not null default now(),
  -- ...and when they stop being servable. Enforced in the read path, and the
  -- default keeps a row that was inserted without one from living forever.
  content_expires_at timestamptz not null default (now() + interval '30 days'),

  updated_at    timestamptz not null default now()
);

-- The viewport query — "accommodation inside this box" — on every map load.
create index places_accommodation_location_gist on places_accommodation using gist (location);

-- Filter pills and destination rollups.
create index places_accommodation_type on places_accommodation (property_type);
create index places_accommodation_country on places_accommodation (country_code);
create index places_accommodation_city on places_accommodation (city);

-- The read path filters on freshness on every request, so it is indexed.
create index places_accommodation_fresh on places_accommodation (content_expires_at);

-- Name search, trigram so "regency" matches "Hyatt Regency Dubai" without a
-- leading-wildcard scan.
create index places_accommodation_name_trgm on places_accommodation using gin (name gin_trgm_ops);

-- Serving only operational properties is the common case, so it gets a partial
-- index rather than filtering the whole table each time.
create index places_accommodation_operational on places_accommodation (property_type)
  where business_status = 'OPERATIONAL';

-- Keep `location` in agreement with the lat/lng pair it was built from. Same
-- reasoning as 0012: doing this in a trigger rather than trusting the writer
-- means a loader bug cannot store a point that disagrees with its own
-- coordinates, so the index and the payload can never diverge.
create or replace function places_accommodation_sync()
returns trigger
language plpgsql
as $$
begin
  new.location := ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;

create trigger places_accommodation_sync_trg
  before insert or update of latitude, longitude on places_accommodation
  for each row execute function places_accommodation_sync();

alter table places_accommodation enable row level security; -- service-role only

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop table if exists places_accommodation;
--   drop function if exists places_accommodation_sync();
--   -- postgis / pg_trgm stay: 0012 and other work depend on them.
-- Nothing references this table, so dropping it touches no balances, orders,
-- bookings or user data.
-- ---------------------------------------------------------------------------
