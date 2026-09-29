# FurlPay — Architecture Gap & Migration Plan

_2026-09-29. Deltas between the target hybrid architecture and what the code already has. Most of the target is already implemented (see CURRENT_STATE.md); this lists only real gaps._

## Classification

### P0 — security/correctness, immediate
**None.** Verified this pass: self-custody keys never reach the server; ledger is balanced/immutable/integer; payments fail closed; webhooks verify + dedupe; no key-accepting routes; no fabricated settlement.

### P1 — required before production financial scale
| Gap | Current | Target | Notes |
|---|---|---|---|
| Prod DB migration state unverified | 0017–0021 in source | confirm applied in prod Supabase | **ops/credential**, not code. Blocks deploy. `verify-hosted-supabase.mjs`. |
| CI blocked | account-level GitHub Actions billing block | green CI | external GitHub billing action. Not a repo fix. |
| Release provenance | manual `vercel deploy`, no git SHA on deployments | stamp SHA/branch/build-id on deploy | see below (safe, local improvement). |

### P2 — scaling/reliability
| Gap | Current | Target |
|---|---|---|
| Durable webhook audit/dedup | Redis/KV `webhookGuard` dedupe | add Postgres `webhook_events(provider, provider_event_id UNIQUE, payload_hash, status, attempt_count, received_at, processed_at)` so dedupe + audit survive cache loss |
| KYC formal state machine | tiered limits + provider webhooks | centralize an explicit FSM (UNVERIFIED→PENDING→REVIEW→APPROVED + REJECTED/EXPIRED/RESTRICTED) behind a `KycProvider` interface |
| Load-test baseline | none measured | `docs/performance/BASELINE.md` with real p50/p95/p99 (do NOT estimate) |
| Observability metrics | structured logs + health | add auth-latency / decline-reason / ledger-imbalance-attempt / RPC-failure metrics |

### P3 — future/optimization
- AWS `infra/aws` is **PARKED** (planned Fargate+Aurora migration; nothing applied; zero runtime AWS SDK). Decide: pursue or remove. Not needed at current scale (Vercel+Supabase serves prod).
- Architecture docs (this set) — created.

## Future-provenance fix (partly implemented this pass)
The "which commit is in prod?" question was unanswerable because manual `vercel deploy` CLI runs do not set `VERCEL_GIT_COMMIT_SHA`, so `/api/ops/health` reported `version: "dev"`.
- **Already existed:** the health route stamps `VERCEL_GIT_COMMIT_SHA` (git-integration deploys only).
- **Added this pass (safe, additive, tested):** health route now falls back to `FURLPAY_BUILD_SHA` — `apps/web/src/app/api/ops/health/route.ts`.
- **Remaining (deliberate, must be tested against a real deploy):** change the ship command to inject it —
  `vercel deploy --prod --build-env FURLPAY_BUILD_SHA=$(git rev-parse HEAD)`. Not edited here because the deploy script is the production ship path and `$(...)` is cross-platform-fragile on the Windows host; apply and verify against one real deploy.
- Tag every release commit. **Rollback:** trivial (additive read-only field).

## Migration discipline
- No giant rewrite — the target architecture is largely already implemented and tested (5,596 web + 307 control-plane tests green).
- Each change: INSPECT → DESIGN → IMPLEMENT → TEST → SECURITY REVIEW → DOCUMENT.
- Nothing here is deployed, pushed, or applied to production without explicit authorization.
