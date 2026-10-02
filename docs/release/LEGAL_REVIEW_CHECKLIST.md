# Legal and compliance review checklist (travel and payments copy)

**Prepared:** 2026-10-02, from the code as it stands on branch `docs/architecture-2026-09-29` (uncommitted).

**Purpose:** list each statement that needs qualified review, where it lives, what the code actually does, and the question for counsel.

**This document reaches no legal conclusions.** "Engineering facts" are what the repository shows. They are not an assessment of compliance.

## How to use it

For each item, counsel records a decision: **approve as written**, **approve with changes** (give wording), or **remove**. Copy is changed only from that decision.

The claims linter (`apps/web/scripts/check-claims.mjs`) and `native-app/lib/__tests__/travelClaims.test.ts` block re-introduction of the removed phrasings.

| # | Topic | Where | Current wording (2026-10-02) | Engineering facts | Question for counsel |
|---|---|---|---|---|---|
| 1 | Price match | `apps/web/src/app/travel/price-match/page.tsx` (+ hub card in `app/travel/page.tsx`, a line in `lib/travel/guides.ts`) | Page labelled "Coming soon"; notice: "Price matching is not available yet. Nothing on this page is an active guarantee…"; it still describes conditions (24h window, $500 cap, mid-market FX) | No claim flow, payout or refund path exists in code | May the planned terms be published before launch, and with which disclaimers? Do the described conditions create an obligation once live? Consumer-protection rules per market |
| 2 | Travel Rule / KYC | `lib/travel/guides.ts` ("planned and not yet part of checkout"); `/legal/travel-rule` (linked from the travel footer) | No claim of enforcement remains in travel UI | Nothing in the booking path collects originator/beneficiary data or checks KYC thresholds | Is the `/legal/travel-rule` policy text consistent with what the product does today? Which obligations apply before travel payments go live, per jurisdiction? |
| 3 | "Instant confirmation" / settlement speed | B2B pages: `app/solutions/airlines`, `app/{uk,ae,jp}/solutions/airlines`, `app/compare/stripe` (+ uk/ae/jp), `app/hotels/[city]`, `app/solutions/enterprise` | Now: "The Arbitrum sequencer confirms a payment within seconds … Full settlement to Ethereum takes longer"; "is confirmed within seconds, cannot be charged back" | Arbitrum sequencer confirmation is seconds; L1 finality is longer. USDC transfers are not reversible by the payer, though the issuer can freeze addresses | Is "cannot be charged back" acceptable, given issuer freeze powers? Any regulated-marketing constraints in the UK, UAE and Japan pages? |
| 4 | PCI DSS | Removed: "no PCI scope", "lowest PCI bracket (SAQ-A)", "PCI DSS card handling via Stripe". Now: "no card form or card data in the flow" | — | Travel checkout takes no card details; merchant hosted checkout is USDC-only; card issuing (Rain) is gated off | Is "no card data in the flow" an acceptable factual statement? Who determines the applicable SAQ when card features launch? |
| 5 | Payment security claims | Travel footer "Secured by FurlPay"; checkout "FurlPay's server calculates the amount you pay"; "One booking per checkout" | — | Server-side quote; idempotency key and per-owner lock; booking itself is disabled in production | Is "Secured by FurlPay" too general? |
| 6 | Refund terms | `/legal/refund` (footer link); cancellation in travel | Cancellation answers 503 in production ("not connected to a travel provider or refund rail") | No refund rail exists; provider cancellation is not implemented | Does `/legal/refund` promise anything the product cannot do today? What must change before travel goes live? |
| 7 | Gift cards | `app/travel/gift-cards`, hub card | "Coming soon: not available yet …" | Purchase and redemption answer 503 in production; no payment, delivery or ledger credit exists | Stored-value / gift-card regulations before launch (expiry, escheatment, disclosure)? The page used to say "Never expires" |
| 8 | Cashback | Checkout "FurlPay cashback (2%)"; marketing "2% cashback auto-deposited" (`app/travel/destinations/[slug]`, `app/travel/itineraries/[slug]`) | Shown as a line item | Cashback is computed (`quoteStay`); crediting it requires a real booking (disabled) and REWARDS_LIVE (unimplemented) | Is "auto-deposited" acceptable while bookings and rewards are not live? |
| 9 | Hotel data (Google Places terms) | `apps/web/src/data/google-places.json`; `docs/hotels-map-google-places.md` §5–6 | Snapshot expired 2026-10-01; layer serves nothing | Snapshot caches names, ratings and addresses that the repo's own notes say the terms do not permit; Places content shown on a non-Google (MapLibre) map | Confirm the caching analysis; may Places content be displayed on MapLibre? Required attribution |
| 10 | Card network marks | Checkout: Visa mark on "One-time virtual card" (Simple Icons path) | Only Visa shown; Mastercard and Amex absent | Virtual cards are Visa (Rain adapter); card issuing is gated off in production | Visa brand-mark usage requirements (size, colour, clear space) for an issued-card context |
