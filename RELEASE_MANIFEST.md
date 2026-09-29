# FurlPay Release Manifest

- **Release branch:** `release/production-2026-09-29`
- **Release commit:** `a05ad10`
- **Base (working branch):** `extension-redesign` @ `971293b`
- **Files changed vs base:** 262
- **New commits:** 19 (16 logical release commits + 3 cherry-picked Dependabot bumps)
- **Safety backups:** tag `backup/pre-release-20260929`, branch `backup/dirty-tree-20260929`, patch `scratchpad/tracked-changes-backup.patch`

## Commits (newest first)

```
19 new commits on release/production-2026-09-29:

  cherry-picks from origin/main (Dependabot, -x recorded):
    - browserslist 4.28.6→4.28.9 (native-app)   [#69]
    - fast-uri 3.1.5→3.1.8                        [#61]
    - js-yaml 3.15.0→3.15.2                       [#77]

  release work:
    ca5dee6 chore(gitignore): exclude local audit evidence scratch dirs
    0a766ce build: dependency pins, route-manifest classification, vitest config
    b9d3d27 fix(web): route hardening, x402 libs, wallet/biometrics, marketing pages
    88dc2f9 test(web): expand control-plane, x402, api-key, and idempotency coverage
    8161a61 feat(web): content, events, leads, revenue, and ARC execution lib layer with tests
    4e139fd docs(audit): production readiness audit, route inventory, provenance, gaps
    a85c71e feat(ios): FurlPay Guardian updates
    5104955 ci: pin third-party actions to commit SHAs, add native PR workflow
    c69251a feat(chaintracker): USDC intelligence pipeline updates
    3e21e3c feat(ops): revenue and leads operator surfaces
    f22b9ba feat(web): events, reports, webinars, and TOKEN2049 content surfaces
    39783ff feat(db): schema assertions, revenue events, content leads migrations
    fdec3bf fix(security): bound earn deposit/withdraw amounts (AGENTS rule 1)
    428a15a feat(payments): v1 authorize/execute, mandates, recipients, evidence APIs
    61ae7b0 feat(control-plane): agentic payment control plane (package + adapters + schema)
    9933e32 chore(gitignore): guard against committing signing material and mobile secrets
```

## Migrations included
`0017_schema_assertions`, `0018_revenue_events`, `0019_content_leads`, `0020_control_plane`, `0021_recipient_attestation` — **not yet applied to any verified production DB.**

## Dependabot bumps NOT integrated (re-apply via Dependabot/npm on this branch)
Conflicted on `package-lock.json` across the divergence; re-applying via a fresh `npm install` is safer than a cross-divergence lockfile merge:
- `sharp` + `next` (#75), `qs` 6.15.3→6.16.0 (#63), production-deps group ×19 (#80), `tsx` (#81), `image-size`+`react-native` native-app (#87), `js-yaml` native-app (#76).

## Excluded from release
- Local audit scratch (`.audit-money-20260929/`, `audit/2026-09-29-*/`) — gitignored.
- `apps/desktop` v0.1.0 — not a production target (excluded from default build filter).
- Stale top-level `furlpay-*` clone dirs — outside the npm workspace.
