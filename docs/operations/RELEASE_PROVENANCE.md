# FurlPay — Release Provenance (operations)

_2026-09-29. How an operator answers: "what exact commit is running in production?"_

## The answer today

**Query the authenticated health endpoint:**
```
GET https://furlpay.com/api/ops/health   (ops-admin auth required)
→ {
    "version": "<sha7>",
    "build": {
      "commitSha", "commitShaShort", "branch",
      "buildId", "environment", "deployedAt"
    },
    ...
  }
```
Every field degrades to `"unknown"` (never crashes) and contains no secrets.

## Why it read "dev"/unknown before, and the fix

- The health route already stamped `VERCEL_GIT_COMMIT_SHA`, but that variable is set **only for git-integration deploys**.
- FurlPay ships via **manual `vercel deploy` CLI**, which does not set git env vars → `version: "dev"`, and the Sep 08 2026 production deployment (`web-2tahxh111`, verified via `vercel ls`) carries **no recoverable commit SHA**.

**Fix (implemented this pass):** the route now falls back to `FURLPAY_BUILD_SHA` (+ `FURLPAY_BUILD_BRANCH`/`_ID`/`_TIME`). To populate it on a CLI deploy:

```
vercel deploy --prod \
  --build-env FURLPAY_BUILD_SHA=$(git rev-parse HEAD) \
  --build-env FURLPAY_BUILD_BRANCH=$(git rev-parse --abbrev-ref HEAD) \
  --build-env FURLPAY_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```
> Not baked into `deploy:prod` yet: `$(…)` is cross-platform-fragile on the Windows host and `deploy:prod` is the production ship script — apply and verify against one real deploy first.

## Recommended release discipline
```
release commit → CI green → immutable SHA → tag → deploy (with --build-env) → verify /api/ops/health → done
```
- Tag every release commit so provenance is anchored on both ends.
- After deploy, confirm `build.commitShaShort` matches the tagged SHA.

## Current known state (verified via `vercel ls web --prod`, read-only)
- Live: `web-2tahxh111`, Sep 08 2026, Ready. Commit SHA: **UNKNOWN** (pre-fix, CLI deploy).
- Last attempt: `web-mtdjuyjf7`, Sep 25 2026, **Error**.
- Rollback target: `web-2tahxh111` / `web-aejjxvkeg`.
