<!--
Keep this short. The point is to make the risky parts of a change visible, not
to fill in a form. Delete any section that does not apply.
-->

## What and why

<!-- What changed, and the reason. The diff already shows the what in detail;
     use this for the why. -->

## Verification

Tick only what you actually ran.

- [ ] `cd apps/web && npx tsc --noEmit`
- [ ] `npm test --workspace @furlpay/web`
- [ ] `npm run build --workspace @furlpay/web` — **runs ESLint; `tsc` and vitest
      passing does not mean this passes.** Two production deployments have been
      broken by a lint error that both other checks let through.
- [ ] Platform checks for anything under `guardian/`, `ios/` or `native-app/`
      (`./gradlew test`, Xcode build — note if a platform could not be built
      locally, e.g. iOS on Windows)

## Money, auth and routes

- [ ] No new API route, or the route is classified in
      `apps/web/security/route-manifest.json`
- [ ] Mutating handlers validate their body with Zod; public routes call
      `rateLimitOr429()`
- [ ] No secret added outside an env var registered in `lib/env.ts` and
      documented in `.env.example`

## Database migration

- [ ] None
- [ ] Included, and applied to staging before this merges
- [ ] Destructive (drops/renames a column or table) — say so in the description
      and expect a slower review

## Published packages

- [ ] No published package touched
- [ ] Changeset added (`npx changeset`)

## Deployment impact

<!-- Anything that is not "merge and it is live": an env var to add first, a
     migration to apply, a flag to flip, an order things must happen in. -->
