# FurlPay — Webhook Security

_2026-09-29. Every inbound webhook, its protections, and the durable dedupe layer added this pass._

## Defense layers (in order)

1. **HMAC signature verification** — per provider, fail-closed (no secret in prod ⇒ 503/401).
2. **`webhookGuard` (KV/Redis)** — fast event-id dedupe (`wh:dedup:{id}`, 24h TTL): `tryBegin`/`markProcessed`/`markFailed`.
3. **Durable Postgres registry (NEW, migration 0022)** — `webhook_events` with `UNIQUE(provider, provider_event_id)`; `claimWebhookEvent` uses `INSERT … ON CONFLICT` so the DB constraint is the ultimate concurrency authority, surviving cache loss. Detects "same id, different body".
4. **Business-operation idempotency** — `withIdempotency` + `markCredited`.
5. **Ledger constraints** — `ledger_post` refuses unbalanced postings.

> The Postgres layer is **additive** — it does not replace layers 1, 2, 4 or 5. Multiple independent guards is the intended posture for money movement.

## Route matrix

| Provider | Route | Signature verified? | Replay protected? | Durable dedupe available? | Financial? | Idempotent? | Failure behavior |
|---|---|---|---|---|---|---|---|
| Stripe | `/api/webhooks/stripe` | ✅ `constructEvent` (HMAC-SHA256), fail-closed in prod | ✅ (Stripe sig incl. timestamp) | ready (0022) | **A. financial** | ✅ webhookGuard + biz | handler fail ⇒ release id ⇒ 5xx ⇒ provider retry |
| Card issuing | `/api/webhooks/card-auth` | ✅ `constructEvent` + `endpointSecret` | ✅ | ready (0022) | **A. financial** | ✅ | fail-closed; passkey step-up for reveal |
| Deposit detect | `/api/webhooks/deposit-detect` | ✅ | ✅ (replay + ordering; `replayIdempotency.spec.ts`) | ready (0022) | **A. financial** | ✅ KV + `markCredited` (keyed by txHash) | fail ⇒ retry; credit exactly once |
| Persona | `/api/webhooks/persona` | ✅ `verifyPersonaSignature` (constant-time, rotation-aware) → 401 | ✅ | ready (0022) | **B. KYC** | ✅ | 401 on bad sig |
| Sumsub | `/api/webhooks/sumsub` | ✅ | ✅ | ready (0022) | **B. KYC** | ✅ | fail-closed |
| ComplyAdvantage | `/api/webhooks/complyadvantage` | ✅ | ✅ | ready (0022) | **B. compliance** | ✅ | fail-closed |
| Resend | `/api/webhooks/resend` | ✅ (svix) | ✅ | n/a | **C. informational** | ✅ | log-only |
| GitHub | `/api/webhooks/github` | ✅ HMAC | ✅ | n/a | **C. informational** | ✅ | log-only |
| Discord | `/api/discord/interactions` | ✅ ed25519 sig | ✅ | n/a | **C. informational** | ✅ | 401 on bad sig |

_"Durable dedupe available (0022)" = the `claimWebhookEvent` primitive + table exist and are unit-tested; **per-route wiring of the financial webhooks is the next step** (deliberately not wired blind in this pass — see below)._

## Durable claim contract (`lib/webhookEvents.ts`)

```ts
const claim = await claimWebhookEvent({ provider, eventId, eventType, payloadHash });
if (claim.payloadMismatch) { /* alert + 400: seen id, different body */ }
if (!claim.claimed)        { /* 200 ack: duplicate/redelivery, no effects */ }
try { /* effects */ await markWebhookProcessed(provider, eventId); }
catch (e) { await markWebhookFailed(provider, eventId, msg); /* 5xx → provider retries */ }
```

## Failure semantics

| Scenario | Behavior |
|---|---|
| Redis unavailable | KV layer degrades; the durable Postgres claim still enforces exactly-once (fail-closed). |
| Postgres unavailable | `claimWebhookEvent` **throws** ⇒ caller returns 5xx ⇒ no financial effect ⇒ provider retries. |
| Worker crashes after claim | Row left `processing`; re-claimable after a 15-min stale window (crash recovery). |
| Same event ×N (sequential) | First claims; rest are `duplicate` ⇒ acked, no effects. |
| Same event concurrent | `INSERT … ON CONFLICT` admits exactly one; losers get `duplicate`. |
| Same id, different body | `payloadMismatch=true` ⇒ do NOT process, alert. |

## Not-yet-done (honest)
- Per-route wiring of `claimWebhookEvent` into the 3 financial webhooks — the primitive is tested; wiring requires running each route against a real Supabase (the store fails closed without it), so it is staged, not applied blind.
- Migration 0022 is **created, not applied** to any environment.
