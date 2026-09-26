# /hotels/map — Google Places integration

Route: `apps/web/src/app/hotels/map/page.tsx` → `components/travel/HotelMap.tsx`
Map renderer: **MapLibre GL** (not the Maps JavaScript API — see §6)

---

## 1. Data sources

The map unions five sources. They are separate values, and nothing may relabel
one as another.

| Source | Where from | Live? |
|---|---|---|
| `curated` | FurlPay's 507 properties | no — FurlPay's own data |
| `osm` | OpenStreetMap, per viewport | live |
| `google` | `src/data/google-places.json` snapshot | **no** — harvested, expires |
| `google-live` | Places API (New), per viewport | **yes** |
| `registry` | `universal_hotels` (migration 0015), vector tiles | no |

`google` and `google-live` are deliberately distinct. When live discovery is
down the map keeps showing snapshot points, and calling those "live" would be a
freshness claim the data does not support.

---

## 2. Required Google Cloud configuration

**Project:** the one owning the Places key (the 403 below names it).

**APIs to enable** — in `console.cloud.google.com/apis/library`:

| API | Needed for | Status |
|---|---|---|
| **Places API (New)** | all live discovery | **must be enabled — currently is not** |
| Maps JavaScript API | not used — MapLibre renders the map | not required |
| Geocoding API | not used | not required |

> **Places API (New) is a different product from the legacy "Places API".**
> Enabling the old one does not satisfy this. Search the library for
> "Places API (New)" specifically.

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | **server only** | every Places call. Never sent to the browser. |

Registered in `apps/web/src/lib/env.ts` and documented in
`apps/web/.env.example`. It lives in `.env.local`, which is gitignored — do not
commit it, and do not add a `NEXT_PUBLIC_` variant. The browser never talks to
Google directly; it calls `/api/places/discover`, which holds the key.

### Key restrictions

Apply both, in the Cloud console:

- **API restriction:** Places API (New) only. A key that can also call
  Geocoding, Directions or Maps is a wider blast radius than this needs.
- **Application restriction:** the key is used server-side, so restrict by IP
  where the deployment has stable egress. An HTTP-referrer restriction is
  wrong here — referrers are a browser-key mechanism and do not apply.

---

## 3. Verifying

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://places.googleapis.com/v1/places:searchText \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: $GOOGLE_PLACES_API_KEY" \
  -H "X-Goog-FieldMask: places.id,places.displayName" \
  -d '{"textQuery":"hotels in Shanghai","maxResultCount":1}'
```

| Response | Meaning |
|---|---|
| `200` | working |
| `400` `API key not valid` | wrong or revoked key |
| **`403` `Places API (New) has not been used in project … or it is disabled`** | **the current state** — enable the API |
| `429` | quota exhausted |

### The expected 403

```
Places API (New) has not been used in project <id> before or it is disabled.
```

This is configuration, not code. The integration is complete and correct; it
returns no results until the API is switched on. Enable it, wait a minute for
propagation, re-run the curl above, then reload `/hotels/map` — live points
appear alongside the indexed ones with no deploy.

---

## 4. Request flow

```
HotelMap.load(bounds, zoom)
  ├── GET  /api/travel/hotels/map      curated + osm + google snapshot   [paints first]
  └── POST /api/places/discover        Places API (New) Text Search      [merged after]
            └── lib/places/viewportDiscovery.ts   rectangle restriction, explicit mask
                  └── lib/places/liveAugment.ts   normalise → dedupe → merge → repaint
```

Live discovery is fired **after** the indexed sources paint and is never
awaited by them. It shares the load's `AbortController`, so a fast pan cancels
it. If it fails, the map keeps what it already drew.

**Text Search, not Nearby Search:** Nearby's `locationRestriction` accepts a
circle only. Serving a viewport through it means either inscribing a circle
(losing the corners) or circumscribing one (returning off-screen places). Text
Search takes a rectangle.

### Cost controls

- Explicit field mask (`MASK_DISCOVERY`) — the mask selects the billing SKU; `*` is never used
- Fires on map idle, not on drag, render, hover or keystroke
- Previous request aborted before a new one starts
- Viewport span capped (`MAX_DISCOVERY_SPAN`, ~20°×20°) — a continental view is refused with "zoom in" rather than answered with 20 arbitrary places
- Rate limited 60/min per IP at the route
- Deduped by place id

---

## 5. Caching policy — **open compliance issue**

Google Maps Platform Terms §3.2.3 permit caching:

- **place IDs** — indefinitely
- **latitude/longitude** — up to 30 consecutive days

Everything else is Places *content* and may not be cached.

`src/data/google-places.json` (16,014 records) persists:

| Field | Permitted? |
|---|---|
| `placeId` | ✅ indefinitely |
| `latitude`, `longitude` | ✅ within 30 days |
| `name`, `rating`, `ratingCount`, `address`, `summary`, `website`, `businessStatus`, `typeDisplay` | ❌ **not permitted** |

The file carries a 30-day expiry and the layer **refuses to serve past it**
(`if (!datasetFresh(now)) return []`), which correctly handles the coordinate
rule — but it implies the other fields are cacheable for 30 days, and they are
not.

**Recommended remediation, once Places API (New) is enabled:** reduce the
snapshot to `placeId` + coordinates + FurlPay's own derived classification, and
resolve display content live per viewport. That is precisely what
`/api/places/discover` now does, so the live path is already in place.

Doing it *before* the API is enabled would empty the map, which is why it is
staged rather than applied. The snapshot self-disables at its expiry regardless.

Photographs are already handled correctly: none are stored. Cards resolve an
image by place id through `/api/travel/hotels/preview`.

Attribution ("Powered by Google") renders unconditionally in `StatusBar` — it
is a condition of displaying the data, not a caption. Do not make it
conditional.

---

## 6. Why MapLibre and not the Maps JavaScript API

The map renders with MapLibre GL from FurlPay's own vector tiles. It already
provides pan, zoom, bounds, idle, search-this-area, markers, clustering,
selection, hover preview and an accessible marker list across 1,724 lines.

Places content must be *displayed on a Google map* under Google's terms when
that content is shown. The live layer therefore needs review before it is
enabled in production on a non-Google renderer — either by moving the map to
the Maps JavaScript API, or by confirming the specific usage is permitted.

**This is the open question to resolve before shipping live discovery to
users.** The code is complete and the switch is configuration, but the policy
question is not a code question.

---

## 7. Related defect (out of scope for this route)

`/api/travel/restaurants` serves **fabricated** data — `generateRestaurants()`
hashes a city name into invented names, ratings and review counts, and decides
crypto acceptance with `cryptoAccepted: (s & 1) === 0`, a coin flip.

It is consumed by `/travel/restaurants` only. `/hotels/map` does **not** use
it and must not start. Tracked separately.
