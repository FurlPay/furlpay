# Contributing to FurlPay

Thanks for taking the time. This document is short and specific — it covers the
few things that are genuinely non-obvious about a repository that moves money.

## Before anything else

**Do not open a public issue for a security vulnerability.** See
[SECURITY.md](SECURITY.md). Publishing one is itself the harm; it cannot be
undone by deleting the comment.

## Repository layout

Turborepo monorepo. The pieces you are most likely to touch:

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 14 App Router — the web app and every API route |
| `apps/extension` | MV3 browser extension (WXT + React) |
| `native-app` | Expo React Native app (Android) |
| `guardian` | Kotlin phone + Wear OS apps |
| `packages/*` | Published SDKs and libraries |
| `supabase/migrations` | Durable schema |

## Getting set up

```sh
npm install
cd apps/web && npx tsc --noEmit   # typecheck
npm test                          # publishable packages
```

Nothing needs credentials to run. `INTEGRATION_MODE` defaults to `mock`, every
integration degrades to a deterministic simulation, and the money paths **fail
closed** rather than fabricating a settlement. That is deliberate — the test
suite must never be able to move real funds.

## The rules that are actually enforced

[`AGENTS.md`](AGENTS.md) is the source of truth and CI enforces a good deal of
it. The ones that reject a pull request most often:

1. **Every mutating handler validates its body with Zod.** Money amounts get
   `.positive()` and an upper bound.
2. **Public routes call `rateLimitOr429()`.** The middleware baseline only
   covers *mutating* methods, so an unauthenticated `GET` has no backstop of its
   own and must bring one.
3. **Authenticated routes call `requireUser()`** — not a hand-rolled
   `verifySession()`. The shared guard also applies the cross-instance
   revocation denylist, MCP connector scopes, the deleted-account tombstone and
   the account lock. A hand-rolled check silently skips all four.
4. **Never merge raw client JSON into stored objects.** Whitelist fields.
5. **Never add a dependency without confirming it exists on npm.** Hallucinated
   package names are a live supply-chain attack vector.

`security/route-manifest.json` is executable policy, not documentation:
`routeManifest.spec.ts` parses every route with the TypeScript compiler and
fails CI when a classification contradicts the implementation. If you add a
route, classify it. If your change removes a guard, the build will say so.

## Tests

Add them for behaviour, not for coverage. Two conventions worth copying:

- **Tests that need a real backend SKIP loudly rather than passing.** The
  Postgres and Redis suites report as skipped when unconfigured, so a green run
  on a laptop is never mistaken for evidence.
- **Assert the thing that would actually break.** Byte layouts, concurrency
  outcomes and failure modes — not that a function returns a value.

## Commits and pull requests

- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`) with a scope.
- Explain *why* in the body. The diff already shows what.
- Run `npx tsc --noEmit`, the test suite and `next lint` before opening.
- Add a changeset (`npx changeset`) for any change to a published package.

## Reporting a bug

Include what you expected, what happened, and the smallest reproduction you
can. For anything money-related, include the correlation id from the response —
the API echoes one on every request and it ties directly to the server-side log.
