# Travel supplier readiness

Live probe of production, 2026-10-09 (`POST https://furlpay.com/api/travel/search`, read-only search, Lisbon / LHR→LIS, 10–13 Nov 2026):

| Category | Adapter in code | Production response | Bookable? | Status |
|---|---|---|---|---|
| Stays | Duffel Stays (`lib/travel/duffel.ts` `searchDuffelStays`, quote + booking) | `source=unavailable`, `no_live_provider` | No | BLOCKED — EXTERNAL DEPENDENCY |
| Flights | Duffel Offers (`searchDuffelFlights`) | `source=unavailable`, `no_live_provider` | No | BLOCKED — EXTERNAL DEPENDENCY |
| Car rentals | Duffel cars (`searchDuffelCars`) | `source=unavailable`, `no_live_provider` | No | BLOCKED — EXTERNAL DEPENDENCY |
| Activities | none | `no_provider_integrated` (route returns nothing by design; the old generator invented every tour) | No | BLOCKED — no supplier chosen |
| Deals | none | `GET /api/travel/deals` → `no_live_rate_provider` | No | BLOCKED — needs live regular + discounted rates |
| Price alerts | in-memory list, no monitor | 503 `not_available` in production | No | OPEN — needs storage + a monitor job |

`duffelMode()` is derived from `DUFFEL_API_KEY`; "live" requires a live-mode key. The production key is not live-mode, so every Duffel-backed search reports `no_live_provider` and the UI says so.

## Booking safety (inspected, no change)

- `POST /api/travel/book` is refused in production (`demoOnlyUnavailable`): the payment authorisation is simulated, so it never returns "confirmed" there. Outside production it has an idempotency key per owner, a 15 s lock (409 `duplicate_booking_in_flight`), server-side repricing (client amounts ignored), and a Duffel reprice that returns 409 `price_changed`.
- `POST /api/travel/settle` confirms a trip only after on-chain USDC verification (contract, recipient, amount, confirmations) with the tx hash claimed single-use for 30 days.
- `cancel/[id]` is production-gated.

## What is needed to go live (external)

1. Duffel live-mode access (contract + KYB) and a live `DUFFEL_API_KEY` in Vercel production env.
2. A real payment rail for travel (replacing the simulated `authorizeBooking`), then removal of the production gate on `/api/travel/book` — a separate, reviewed change.
3. An activities supplier and a deals/rates source, each a product + contract decision.
