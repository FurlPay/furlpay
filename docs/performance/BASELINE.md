# FurlPay — Performance Baseline

_2026-09-29._

## Status: **NOT MEASURED**

No load test was executed this pass, and no latency numbers are reported — deliberately, rather than estimating.

### Why not measured
- The authorization/payment path is **fail-closed with no rail connected** (`503 rail_not_connected`), so a load test of it would measure the refusal path, not real settlement — misleading.
- Production endpoints are auth-gated and hitting them under load would touch live infrastructure (out of scope: no destructive/production load).
- Realistic numbers require a provisioned local stack (Supabase + Upstash + signed webhook fixtures) that is not stood up here.

### What IS measured (functional, not load)
- `apps/web` build: `next build` exit 0.
- Test suite wall-clock: full `vitest run` ~66s for 5,596 tests (a throughput signal for the test harness, **not** a service latency).

## Harness plan (not yet run)
When a local stack is available, use k6 (lightweight, scriptable) against **local/test** infra only:

| Scenario | Target | Concurrency | Metrics |
|---|---|---|---|
| Operational health | `GET /api/ops/health` (auth) | 100, 1000 | p50/p95/p99, RPS, error rate |
| Read-only API | a representative authenticated GET | 100, 1000 | same |
| Webhook ingestion | correctly-signed test fixtures → local | 100, 1000 | same + dedupe correctness |
| Authorization | control-plane authorize (mock rail) | 100, 1000 | same |

Record per scenario: environment, commit SHA, date, machine, DB/Redis mode, requests, concurrency, success rate, p50/p95/p99, max, RPS, errors.

**Rule:** never write an estimated latency as a measured one. Until the harness runs, this file stays `NOT MEASURED`.
