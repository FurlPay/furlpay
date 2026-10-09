# Rollback runbook — partnerships + travel line

Production is a Vercel deployment of project `web` (team `ashutoshs-projects-754ff406`), aliased to `furlpay.com` and `www.furlpay.com`. Rolling back re-points the alias; it rebuilds nothing.

## Known deployments (newest first)

| Deployment URL | Commit | Safe rollback target? |
|---|---|---|
| `web-49pzbab24-…vercel.app` (current) | `eca878c0` | — |
| `web-116bbwprm-…vercel.app` | `2d0368ec` | Yes: partners on /partnerships, no travel hero |
| `web-7geumqqk9-…vercel.app` | `e2933dfc` | Yes: partners on /partners |
| `web-gmzchst5a-…vercel.app` | `183b13db` | Yes: before the partners release |

## Procedure

1. Confirm what is live: `npx vercel inspect furlpay.com`.
2. Roll back to the previous production deployment: `npx vercel rollback` — or to a specific one: `npx vercel rollback https://web-116bbwprm-ashutoshs-projects-754ff406.vercel.app`.
3. Verify: from the repo root, `npm run smoke:prod`. Expect the known P0-05 failures (rate-limit store) until Upstash is upgraded; everything else must PASS.
4. Record who rolled back, why, and the deployment ids.

## Data and configuration

- **Database:** this release adds only migration `0049_partnership_inquiries.sql` (new tables + functions, nothing altered or dropped). It is NOT applied in production. If it is applied later, older deployments simply never call it — rollback needs no database step.
- **Feature flags:** none introduced. Travel booking stays refused in production by `demoOnlyUnavailable` in every deployment listed.
- **Environment:** `PARTNERSHIPS_NOTIFY_EMAIL` is new and optional; older deployments ignore it.

Ownership: the repository owner performs promotes and rollbacks (no on-call rotation exists in the repo).
