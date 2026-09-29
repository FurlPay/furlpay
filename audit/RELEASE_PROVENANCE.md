# FurlPay Release Provenance

_Audit date: 2026-09-29 · Read-only analysis._

## Branches

| Branch | Role | Notes |
|---|---|---|
| `origin/main` | `origin/HEAD` (nominal default) | 9 commits the working branch lacks |
| `extension-redesign` | active working branch (checked out) | 320 commits `main` lacks; HEAD `971293b` |

**Merge base:** `a963878`.

## The 9 `main`-only commits — all Dependabot dependency bumps

```
19b6363 build(deps-dev): bump js-yaml 3.15.0→3.15.2 in /native-app (#76)
38333cd build(deps): bump image-size and react-native in /native-app (#87)
228ced3 build(deps-dev): bump tsx in the production-deps group (#81)
b17bef8 build(deps): bump qs 6.15.3→6.16.0 (#63)
8bf395c build(deps-dev): bump js-yaml 3.15.0→3.15.2 (#77)
f795959 build(deps): bump sharp and next (#75)
97841b5 build(deps): bump fast-uri 3.1.5→3.1.8 (#61)
282bde5 build(deps): bump production-deps group, 19 updates (#80)
dbdd355 build(deps): bump browserslist in /native-app (#69)
```

**Finding (P1):** `extension-redesign` — the branch that carries all real feature/security work and is almost certainly what production ships from — is **missing 9 merged dependency updates** that landed on `main`, including `sharp`/`next` and `qs` bumps that are typically security-motivated. The working branch is behind `main` on dependency hygiene.

## The 320 `extension-redesign`-only commits — not one release

By conventional-commit type:

| Type | Count |
|---|---|
| feat | 109 |
| fix | 62 |
| markets | 22 |
| docs | 18 |
| chore | 9 |
| price | 7 |
| travel / security / places / discord | 5 each |
| test / seo | 4 each |

This is **many months of unrelated work**, not a single releasable unit. There is **no tag** at HEAD; the only release tags (`android-v1.0.0`, `ledger-v1.0.0`) point at older commits.

## What is actually in production (furlpay.com) — VERIFIED via Vercel (read-only, 2026-09-29)

Authenticated as `ashutosh0x`, `vercel ls web --prod`:

| Deployment | Created | Status |
|---|---|---|
| `web-mtdjuyjf7` | Sep 25 2026 (5d ago) | ● **Error** (failed deploy) |
| **`web-2tahxh111`** | **Sep 08 2026 (21d ago)** | ● **Ready — CURRENT LIVE** |
| `web-aejjxvkeg` | Sep 08 2026 | ● Ready (rollback target) |
| `web-b9s91me40` | Sep 07 2026 | ● Ready |

**Current production = `web-2tahxh111`, live since Sep 08 2026 (~21 days / ~340 commits stale).** The most recent deploy attempt (Sep 25) **errored** — consistent with the dirty-tree / CI-block state found in this audit.

**Production commit SHA: still UNKNOWN.** `vercel inspect` shows no git metadata on these deployments — they were shipped via the manual `vercel deploy` CLI without Git integration, so no commit SHA is attached. The deployment *ID* and *date* are known; the source *commit* is not recoverable from Vercel. (Per rule, NOT inferred from local git history.)

- `furlpay.com` → **200**; `/api/ops/health` → **401** (auth-gated). Live, and matches the Sep 08 deployment.
- **Rollback target:** promote `web-2tahxh111` (current) or `web-aejjxvkeg` via Vercel "Promote to Production".

## Recommended integration strategy (do NOT execute without approval)

1. **Rebase/merge the 9 Dependabot commits into `extension-redesign` first** (or cherry-pick), run `npm audit` + full test suite, so the working branch is not behind on security bumps.
2. **Commit the 166 dirty paths in logical units** (control-plane payments; events/reports/webinars content; ops/revenue; workflow SHA-pins; migrations 0018–0021) — they are finished, tested work sitting uncommitted and at risk of loss.
3. **Decide the branch model:** either fast-forward `main` to `extension-redesign` (making the working branch canonical) or formally designate `extension-redesign` as the release branch and update `origin/HEAD`. The current split makes `origin/HEAD` misleading.
4. **Tag the release** so the next deploy has provable provenance.
5. Only then deploy via the gate.

## Release provenance evidence table (2026-09-29)

Labels: **VERIFIED** (established by a command/evidence) · **UNKNOWN** (cannot be established here) · **UNVERIFIED** (needs an external check) · **PARKED** (deliberately deferred, not a release blocker).

| Item | Status | Evidence |
|---|---|---|
| Release branch | VERIFIED `release/production-2026-09-29` | git |
| Release commit | VERIFIED (HEAD of release branch) | git |
| Working tree | clean before this doc's dep/provenance commit | git status |
| Pushed | NO (not authorized) | local only |
| Tagged (release) | NO | git tag |
| Previous production SHA | **UNKNOWN** | Vercel deployments carry no git metadata (manual CLI deploy) |
| Current live production | **VERIFIED** `web-2tahxh111`, Sep 08 2026, Ready | `vercel ls web --prod` |
| Last deploy attempt | **VERIFIED** `web-mtdjuyjf7` Sep 25 2026 = Error | `vercel ls` |
| Rollback target | `web-2tahxh111` / `web-aejjxvkeg` | Vercel Ready deployments |
| Supabase migrations 0017–0021 | **UNVERIFIED** | read-only DB probe declined by operator |
| AWS | **PARKED / not required** | zero AWS SDK in runtime; RUNBOOK "nothing applied"; creds invalid |
| CI (GitHub Actions) | **UNVERIFIED external blocker** — account-level Actions block | every workflow fails 3–6s across schedule+PR+CI; SHA pins valid |
| Security (app-layer) | **VERIFIED clean** | 343-route scan: 0 auth/HMAC gaps; no tracked secrets |
| Security (git history) | **UNVERIFIED** | gitleaks/trufflehog not installed |
| Dependency bumps | **VERIFIED** qs 6.16.0, sharp 0.35.5, tsx 4.23.15 | npm update --package-lock-only + install; tsc/build green |
| Android | native-app v2.3.0 (vc7) canonical; TWA deprecated in-repo | app.json; apps/android/DEPRECATED.md |
| iOS | **BLOCKED** | no macOS/Xcode |
| Wear OS | **BLOCKED** | JDK 8 only (needs 17) |
| Chrome extension | **VERIFIED build** | tsc + build + zip (MV3, least-privilege) |
| Payment rail | **NOT CONNECTED (by design)** | 0 adapters outside tests; execute → 503 rail_not_connected |
