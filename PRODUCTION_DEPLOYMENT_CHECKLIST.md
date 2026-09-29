# FurlPay Production Deployment Checklist

_Prepared 2026-09-29 on `release/production-2026-09-29`._

## Web / Backend (Vercel project `web`)

The repo's own gate (`apps/web/scripts/check-deploy-gate.mjs`) enforces: clean tree + pushed HEAD + green CI for the exact SHA. **Deploy command: `npm run deploy:prod` from repo root.** Never bare `npx vercel deploy --prod`.

| # | Gate | Status | Notes |
|---|---|---|---|
| 1 | Clean working tree | ✅ | release branch committed |
| 2 | Exact release commit recorded | ✅ | see RELEASE_MANIFEST.md |
| 3 | Production build passes | ⏳/see report | `next build` |
| 4 | Tests pass | ✅ | 5596 web + 307 control-plane + root packages |
| 5 | Security checks pass | ⚠️ | app-layer clean; full gitleaks history scan NOT run locally |
| 6 | No unresolved P0 | ✅ | none |
| 7 | No deployment-blocking P1 | ❌ | branch unpushed, CI not run for SHA, prod DB state unknown |
| 8 | DB migrations compatible w/ prod schema | ❌ **BLOCKER** | prod Supabase state UNVERIFIED (no creds) |
| 9 | Rollback target known | ⚠️ | previous deploy = Vercel "Promote previous"; exact prior SHA UNKNOWN |
| 10 | Deployment mechanism understood | ✅ | `deploy:prod` → Vercel |

**Deploy decision: DO NOT DEPLOY from this environment.** Gates 7, 8, 9 are unmet:
- The branch is unpushed and no CI run exists for the release SHA (gate would refuse anyway).
- Production Supabase migration state is unverifiable here; the release adds migrations 0017–0021, and deploying app code that expects tables/RLS not yet applied would break production.
- The exact current production commit / rollback target is unprovable (see RELEASE_PROVENANCE.md).

## Database migration checklist (migrations 0017–0021 new this release)

Before any deploy that depends on them:

1. **Inspect prod + staging applied state:** `node apps/web/scripts/verify-hosted-supabase.mjs` (needs Supabase creds).
2. Confirm ordering 0001→0021 with no gaps (verified in source; files present and sequential).
3. **0016 (RLS on money tables), 0020 (control_plane), 0021 (recipient_attestation)** must be applied *before* the app code that reads them goes live — apply DB first, then app.
4. Verify RLS policies are enabled on every money table (0016/0017 schema assertions cover this).
5. Money precision: amounts are stored/handled in minor units (atomic strings) in the control plane — no float. Verify column types on `cp_*` tables.
6. Apply forward-only; no destructive statements. Take a snapshot/PITR checkpoint first (prod is PITR-enabled per infra header).
7. Re-run `verify-hosted-supabase.mjs` post-apply to confirm.

## Payment rail gate

- `execute` returns `503 rail_not_connected` in production (0 adapters registered) — **by design**. Do not connect a rail as part of this release. Ship with the capability gated; the UX must communicate unavailability. Real-money movement is a separate, authorized change.

## AWS

- Terraform present but creds invalid → do NOT `terraform apply`. Decide first whether AWS is in-use (verify) or park the IaC. `terraform` binary is not installed locally, so even `validate`/`fmt -check` can't run here.
