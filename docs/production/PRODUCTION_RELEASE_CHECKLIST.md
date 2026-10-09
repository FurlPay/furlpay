# Production release checklist — partnerships + travel

Tick only with evidence. Owner approval is required for every promote.

## Mandatory gates

- [ ] Remote CI green for the release SHA — **BLOCKED** (Actions billing, P0-03)
- [x] Typecheck clean on the release SHA (TypeScript 5.5.3, pinned version)
- [x] Lint clean on changed areas
- [x] Unit/component/policy tests run; failures limited to known environment issues (`nativeParity.spec.ts`, Expo not installed)
- [x] `releaseBranchGate.spec.ts` 25/25
- [x] Production build succeeded (Vercel preview build of a clean clone of the SHA)
- [ ] Smoke suite green against production — **3 required failures**, all caused by the rate-limit store outage (P0-05), present before this release
- [x] Admin boundary closed: `/api/admin/partnerships` 401 anonymously (smoke)
- [x] Rollback target identified (ROLLBACK_RUNBOOK.md)
- [ ] Release provenance attested by CI — **UNVERIFIED** (inferred only; P0-01)

## Before the partnership form can work

- [ ] Upstash plan upgraded (P0-05)
- [ ] Migration 0049 applied to production (needs authorization)
- [ ] `PARTNERSHIPS_NOTIFY_EMAIL` + `RESEND_API_KEY` confirmed in production env
- [ ] One labelled test inquiry submitted and verified (row + email)

## After promoting

- [ ] `npm run smoke:prod` (repo root)
- [ ] Spot-check `/partnerships`, `/travel`, `/travel/stays?city=Lisbon`, `/travel/deals` on a phone
- [ ] Watch `travel_search` result events (phase `result`) for unexpected `failed` outcomes
