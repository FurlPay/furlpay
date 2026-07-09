# Copilot Instructions — FurlPay

These mirror `AGENTS.md` at the repo root, which is the source of truth. Keep
the two in sync when either changes.

## Security (mandatory for all API routes)

- Every POST/PUT/PATCH handler validates its body with Zod — a schema in
  `apps/web/src/lib/schemas.ts` via `parse()`, or inline via `validateBody()`
  from `@/lib/validate` (which also enforces the 100KB body cap). Money amounts
  always get `.positive()` and an upper bound.
- Public routes call `rateLimitOr429()` from `@/lib/rateLimit`. Authenticated
  routes are backstopped by the middleware baseline (150 mutating req/min/IP);
  add a tighter per-route limit for anything money-moving or email/SMS-sending.
- Webhook handlers verify an HMAC signature over the raw body with
  `crypto.timingSafeEqual`, reject stale timestamps, and fail closed when the
  secret is unset.
- Never merge raw client JSON into stored objects (mass assignment). Whitelist
  fields explicitly. `user.security` holds `totpSecret` and is only written
  through `/api/security/mfa`.
- Never return `totpSecret`, private keys, or session secrets in any response.
- Use `crypto.randomUUID()` / `crypto.getRandomValues()`, never `Math.random()`,
  for anything security-relevant.
- No `eval()`, no `new Function()`, no `dangerouslySetInnerHTML` with user
  input. JSON-LD goes through `components/JsonLd.tsx`, which escapes `<`.
- Oracle prices need sanity bounds and a degradation path — see `solUsdPrice()`
  (Pyth, SOL clamped to $1–$2000, falls back rather than blocking payment).
- Validate Solana addresses with `new PublicKey()` in try/catch; EVM addresses
  against `/^0x[0-9a-fA-F]{40}$/`.
- Server-only secrets never carry the `NEXT_PUBLIC_` prefix. Register every env
  var in `apps/web/src/lib/env.ts` and document it in `apps/web/.env.example`.
- Never add a dependency without confirming it exists on npm. Never run
  `npm audit fix --force`; accepted advisories live in
  `.github/audit-allowlist.json` with reasons.

## Architecture

- Next.js 14 App Router (`app/**/route.ts` handlers), TypeScript strict.
- Upstash Redis (`@/lib/kv`) for rate limits, webhook dedup, and durable state.
- Helius for Solana RPC and Bubblegum v2 cNFT mints; Pyth Hermes for SOL/USD.
- LI.FI (`li.quest`) for cross-chain swap quotes — not Jupiter.
- Passkey (WebAuthn) auth; JWT sessions verified in edge middleware.

## Conventions

- Match the surrounding file's comment density and naming. Comments explain
  constraints the code cannot show, not what the next line does.
- Typecheck before committing: `cd apps/web && npx tsc --noEmit`.
- Tests are per-workspace with Node's built-in test runner (`npm test` at the
  root runs the SDK, compliance, security, and ledger suites). There is no
  Vitest or Jest in this repo — do not introduce one without discussion.
- Deploys are manual: `npx vercel deploy --prod --yes` from the repo root.
  Pushing to GitHub does not deploy.
