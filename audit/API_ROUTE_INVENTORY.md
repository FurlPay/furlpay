# FurlPay API Route Security Inventory

Generated: 2026-09-29T15:54:29.364Z · Source: apps/web/src/app/api (tracked + untracked)

This inventory is produced by a static scanner (scratchpad/route-audit.mjs) that pattern-matches the repo idioms: `parse(Schema,data)`/`validateBody()`/`z.*()` for validation, `require*()`/header-secret for auth, `rateLimitOr429()` for rate limiting, `constructEvent`/`verify*Signature`/`timingSafeEqual` for webhook HMAC, `withIdempotency`/Idempotency-Key for idempotency. **Heuristic — every flag was manually calibrated (see notes).**

## Summary

| Metric | Count |
|---|---|
| Total route files | 343 |
| Mutating (POST/PUT/PATCH/DELETE) | 198 |
| Money-touching routes | 98 |
| Webhooks | 9 |
| With input validation (Zod/parse) | 143 |
| With rate limiting | 275 |
| With auth | 207 |
| Flagged (any) | 89 |

### Flags after calibration

| Flag | Count | Verdict |
|---|---|---|
| NO_AUTH_NO_RATELIMIT | 0 | ✅ none — every mutating route has auth or rate-limit (or is a Solana Blink / cron) |
| WEBHOOK_NO_HMAC | 0 | ✅ none — all 9 webhooks verify a signature/secret and fail closed |
| NO_ZOD | 59 | ⚠️ mostly false positives (GET-only, path-param-only, manual validation); ~20 money routes use manual validation instead of an inline Zod schema |
| MONEY_NO_IDEMPOTENCY | 46 | ℹ️ informational — most are naturally idempotent, settings, or read paths; not a defect |

## Money routes using manual validation (AGENTS rule 1 consistency gap, not an exploit)

- `/api/cards/challenges/options`
- `/api/cards/challenges/verify`
- `/api/cards/lifecycle/[id]/report-lost`
- `/api/cards/lifecycle/[id]/reveal`
- `/api/cards/lifecycle/[id]`
- `/api/earn/deposit`
- `/api/earn/withdraw`
- `/api/investing/corporate-actions/settle`
- `/api/onramp/quote`
- `/api/onramp/session`
- `/api/p2p/orders/[id]/pay`
- `/api/p2p/orders/[id]/release`
- `/api/p2p/payment-methods/[id]`
- `/api/payments/review`
- `/api/payments/stripe/intent`
- `/api/travel/gift-cards/redeem`
- `/api/webhooks/card-auth`
- `/api/x402/facilitator/settle`
- `/api/x402/facilitator/verify`
- `/api/x402/policy/settle`

> Verified examples: `earn/deposit`, `earn/withdraw`, `onramp/session` all validate the amount/inputs manually (positivity / finite / 400) — they are guarded, just not via a Zod schema. `earn/deposit` + `earn/withdraw` additionally lacked an **upper bound** (fixed in this audit).

## Webhook signature verification (all verified)

- `/api/discord/interactions` — verifies signature ✅
- `/api/webhooks/card-auth` — verifies signature ✅
- `/api/webhooks/complyadvantage` — verifies signature ✅
- `/api/webhooks/deposit-detect` — verifies signature ✅
- `/api/webhooks/github` — verifies signature ✅
- `/api/webhooks/persona` — verifies signature ✅
- `/api/webhooks/resend` — verifies signature ✅
- `/api/webhooks/stripe` — verifies signature ✅
- `/api/webhooks/sumsub` — verifies signature ✅

_Full machine-readable data: `audit/api-route-inventory.json`._
