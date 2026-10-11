# 02 — Security architecture (as verified)

Scope: the web application and API (`apps/web`, Next.js 15 on Vercel), the
shared packages it loads, the EVM contracts (`packages/contracts`, none
deployed), the Expo mobile app (`native-app`) and the iOS Guardian app.

## Trust boundaries

| Boundary | Enforced by | Notes |
|---|---|---|
| Internet → API | `src/middleware.ts` | Declared body cap (100 KB; one reviewed exception, Allium 1 MB), CSRF origin check for cookie-authenticated mutations, baseline 150 mutating req/min/IP, API version negotiation, origin-verify header on the AWS path. |
| Request body → handler | `lib/validate.ts` | Every route reads its body through `readJsonBody` / `readTextBody` / `readFormBody` / `validateBody`, which stop the stream at the cap whatever Content-Length says (F-10). |
| Session → account | `lib/session.ts`, `lib/authz.ts` | HS256 pinned, issuer and audience checked, jti revocation in memory and Redis; revocation unknown → read-only. The development secret is refused in production and on any hosted runtime (F-7). |
| Webhook provider → handler | per-route HMAC over the raw text, `lib/webhookGuard.ts` | Constant-time compare, timestamp tolerance, Redis SET NX dedup; fail closed without a secret. |
| Agent → payment | `lib/x402.ts`, `/api/agents/ap2` | Quote-binding HMAC, single-use quote and nonce claims in Redis, confirmation depth by value; AP2 mandates single-use across instances (F-13). |
| Preview → production data | `lib/dataPlane.ts` | A non-production deployment refuses production Supabase/Redis unless explicitly isolated. |

## Fail-closed dependencies

Redis (Upstash) carries replay claims, webhook dedup, rate limits and session
revocation. In production the in-memory fallback is refused, so a Redis
outage refuses money-moving and single-use operations rather than serving
them from per-instance memory.
