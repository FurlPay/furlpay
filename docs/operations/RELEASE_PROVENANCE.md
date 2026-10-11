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
**Baked into `deploy:prod` (11 Oct 2026):** `npm run deploy:prod` now runs `apps/web/scripts/deploy-prod.mjs`, a Node wrapper (no shell `$(…)`, so it works under cmd.exe). It runs the deploy gate, then `vercel deploy --prod` with `FURLPAY_BUILD_SHA`, `FURLPAY_BUILD_BRANCH` and `FURLPAY_BUILD_TIME` passed as both `--build-env` and `--env` — `--build-env` alone is visible only while building, and `buildInfo()` reads `process.env` at runtime — plus `--meta gitCommitSha=… gitCommitRef=…` so `vercel inspect --json` shows the commit. Verify on the first real deploy: `/api/ops/health` (admin) `build.commitSha` and `vercel inspect <url> --json` `meta.gitCommitSha` must both equal the released SHA.

**11 Oct 2026 production (`dpl_31mdtjFARgnr16CqtpxFVfhL6po9`):** no metadata (pre-wrapper CLI deploy). Identified by content instead: `/llms.txt` is byte-identical to `0dce509b` (and differs from the previous `d3d7422e`), `/api/security/lock` serves the `0dce509b` link page, and `/api/agents/ap2` answers with `0dce509b`’s validation message rather than #115’s. Confidence high, but by fingerprint, not metadata.

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
