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

## What is actually in production (furlpay.com)

**UNKNOWN / unprovable from this environment.** Deploys are manual (`npm run deploy:prod` → Vercel project `web`), so the deployed commit is whatever a checked-out tree was at deploy time. `.vercel/project.json` records the project, not the deployed SHA. There is no deployment-metadata file, git note, or release tag tying a commit to the live deployment.

- `furlpay.com` responds **200**; `/api/ops/health` responds **401** (auth-gated) — so *something* recent is live, but not which commit.
- To resolve: `vercel inspect` / `vercel ls` against project `web` (needs Vercel auth), or read the deployed commit from the Vercel dashboard.

## Recommended integration strategy (do NOT execute without approval)

1. **Rebase/merge the 9 Dependabot commits into `extension-redesign` first** (or cherry-pick), run `npm audit` + full test suite, so the working branch is not behind on security bumps.
2. **Commit the 166 dirty paths in logical units** (control-plane payments; events/reports/webinars content; ops/revenue; workflow SHA-pins; migrations 0018–0021) — they are finished, tested work sitting uncommitted and at risk of loss.
3. **Decide the branch model:** either fast-forward `main` to `extension-redesign` (making the working branch canonical) or formally designate `extension-redesign` as the release branch and update `origin/HEAD`. The current split makes `origin/HEAD` misleading.
4. **Tag the release** so the next deploy has provable provenance.
5. Only then deploy via the gate.
