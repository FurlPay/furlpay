# CI and release status

## Remote CI — BLOCKED

GitHub Actions jobs are not started: *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* Nothing in the repository can fix this. Owner action: GitHub → Settings → Billing & plans. Also note `ci.yml` triggers only on pushes to `main`/`extension-redesign` and on pull requests, so a branch push runs nothing even when billing works.

## Deploy gate

`npm run deploy:prod` runs `apps/web/scripts/check-deploy-gate.mjs`: clean tree, pushed HEAD, HEAD on the release branch, and a green CI run for that exact SHA. With CI blocked it cannot pass without `FURLPAY_DEPLOY_FORCE=1` + a written reason. Its release branch defaults to `extension-redesign` (P0-04); production has been shipped from `release/partners-on-prod` through dashboard promotes, which bypass the gate entirely.

## Local verification (this release branch)

Commands run from `apps/web` unless noted. Results are recorded in the final report of the change that added this file.

| Check | Command |
|---|---|
| Typecheck (pinned TS) | `npx -p typescript@5.5.3 tsc --noEmit -p .` |
| Lint (changed areas) | `npx eslint src/app/travel src/components src/lib/travel scripts/check-deploy-gate.mjs` |
| Tests | `npx vitest run src/lib src/components src/app` |
| Release-policy tests | `npx vitest run src/lib/__tests__/releaseBranchGate.spec.ts` |
| Production build | Vercel build of a clean clone (`npx vercel deploy --yes --archive=tgz`, preview target) |
| Smoke | repo root: `npm run smoke:prod` (production) |

## Provenance (2026-10-09)

| Deployment | Created (IST) | Content |
|---|---|---|
| `web-49pzbab24` / `dpl_SGe8rNfYsDUrVt1jrK14cjhi8U2K` — **production now** | 18:15 | `eca878c0` (travel hero) — inferred from `/travel/hero/*` 200 and `/dashboard/partnerships` 308 |
| `web-116bbwprm` / `dpl_A4NGTeLsyi1Y7duaNKZXUpgY9SV3` | ~17:09 | `2d0368ec` (/partnerships move) |
| `web-7geumqqk9` / `dpl_7Qqwq4QzQcX1GcQ9cxGUJrSSURPB` | 16:48 | `e2933dfc` (first partners release) |
| `web-gmzchst5a` / `dpl_FDcTGExABpJWVcLXGz9pyHtKPX1M` | Oct 8 22:45 | `183b13db` (production line before this release) |
