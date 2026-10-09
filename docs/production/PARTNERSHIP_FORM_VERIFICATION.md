# Partnership form — verification

Public page `/partnerships` (`/partners` and `/dashboard/partnerships` 308 → it). Submit: `POST /api/partnerships/inquiries`. Staff read: `GET/PATCH /api/admin/partnerships` (admin role).

## Verified in code and tests

| Concern | How | Evidence |
|---|---|---|
| Validation | One Zod schema for client and server; per-method contact normalisation (Telegram, WhatsApp E.164, email, LinkedIn URL, Discord) | `lib/partnerships/__tests__/partnerships.spec.ts` |
| Body cap | 16 KB, counted in UTF-8 bytes (`validateBody` fix `84c64d10`) | validate.ts |
| Bots | Honeypot field + minimum fill time 1.5 s | route + spec |
| Rate limit | 5 / 10 min / IP, fail-closed bucket (it sends email) | `rateLimit.ts` |
| Persistence before acknowledgement | `partnership_inquiry_submit` RPC; "received" only after commit; 503 without storage, 502 on storage error — never a pretend success | route |
| Duplicates | Same email + interest + UTC day = one inquiry (`duplicate:true`, 200) | migration 0049 unique index |
| Data access | RLS on, no grants to anon/authenticated; admin route requires `admin` role; logs carry id/outcome only | migration 0049, `adminPartnerships.spec.ts`, `publicPartnershipRoutes.spec.ts` |
| Notification | Resend to `PARTNERSHIPS_NOTIFY_EMAIL`; outcome stored as `sent` / `failed` / `not_configured`, never assumed | repository.ts |
| UI | Custom dropdowns (keyboard, touch, viewport), focus management, success heading focus, discard confirmation | `PartnershipModal.spec.tsx`, `PartnershipSelect.spec.tsx`, Chromium runs at 1440 and 390 |

## Production status: BLOCKED

`POST /api/partnerships/inquiries` with an empty body returns **503 `temporarily_unavailable`** on furlpay.com (smoke probe): the fail-closed rate-limit store is over its Upstash plan limit. Even with the store back, submissions fail until **migration 0049** is applied to the production database. No real submission was made in testing (it would store a row and email the team).

Required, in order: (1) upgrade Upstash, (2) apply `supabase/migrations/0049_partnership_inquiries.sql` to production (authorization needed), (3) confirm `PARTNERSHIPS_NOTIFY_EMAIL` and `RESEND_API_KEY` are set, (4) submit one labelled test inquiry and check the row and the email.
