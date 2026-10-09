# Partnerships + travel — baseline inventory

Release branch `release/partners-on-prod`, production line base `183b13db`. Findings are tracked by id in [P0_P7_REMEDIATION.md](P0_P7_REMEDIATION.md).

| Feature | Route | Main component(s) | Backend | Provider | Verified state (2026-10-09) |
|---|---|---|---|---|---|
| Partnership page | `/partnerships` (`/partners`, `/dashboard/partnerships` → 308) | `components/partnerships/PartnersExperience.tsx`, `PartnershipModal.tsx`, `PartnershipSelect.tsx` | `POST /api/partnerships/inquiries`; `GET/PATCH /api/admin/partnerships` | Supabase (migration 0049), Resend | Page public 200; submit 503 in production (P0-05, P3-01) |
| Travel home | `/travel` | `components/travel/home/HomeHero.tsx`, `HeroMotion.tsx`, `HeroTripCard.tsx` | static itineraries (`lib/travel/discover.ts`) | none | Live; prices are itinerary budgets, labelled |
| Stays | `/travel/stays` | `app/travel/stays/page.tsx`, `components/travel/Filters.tsx`, `EmptyState.tsx` | `POST /api/travel/search` (stays) | Duffel (not live) | `no_live_provider` → honest empty state |
| Flights | `/travel/flights` | `app/travel/flights/page.tsx` | `/api/travel/search` (flights) | Duffel (not live) | `no_live_provider` |
| Car rentals | `/travel/car-rentals` | `app/travel/car-rentals/page.tsx` | `/api/travel/search` (cars) | Duffel (not live) | `no_live_provider` |
| Activities | `/travel/activities` | `app/travel/activities/page.tsx` | `/api/travel/search` (activities) | none | `no_provider_integrated` |
| Deals | `/travel/deals` | `app/travel/deals/page.tsx` | `GET /api/travel/deals` | none | `no_live_rate_provider`; countdown removed |
| Hotel map | `/hotels/map` | `components/travel/HotelMap.tsx`, `map/HotelResultsPanel.tsx` | `/api/travel/hotels/map` | indexed properties | Indexed records, not bookable rates |
| Entry requirements | `/travel/visa` | `components/travel/EntryRequirementsCheck.tsx` | `/api/travel/entry-requirements` | static rules | Shared country Select |
| Price alerts | `/travel/alerts` | `app/travel/alerts/page.tsx` | `/api/travel/alerts` | none | 503 in production; page now says so |
| Booking | `/travel/checkout` | `app/travel/checkout/*` | `POST /api/travel/book`, `/api/travel/settle` | simulated payment | Refused in production (fail closed) |
| Shared dropdown | — | `components/form/Select.tsx` | — | — | Used by travel + partnership; tests `components/form/__tests__/Select.spec.tsx` |
