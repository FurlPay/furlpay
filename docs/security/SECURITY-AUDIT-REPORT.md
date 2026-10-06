# FurlPay security audit report

**Date:** 2026-10-06 · **Branch:** `security/full-audit-2026-10-06` (from `codex/cross-platform-audit` @ `86656d9`) · **Scope figures:** `docs/security/AUDIT-SCOPING-PACK.md` (≈273k SLOC in scope).
Findings: `SECURITY-AUDIT-FINDINGS.md` · Invariants: `SECURITY-INVARIANTS.md`.

## Executive summary

This was a single-session internal audit of a ~273k-SLOC codebase. Review was deepest on the paths where money moves, sessions are issued and on-chain value is held, and lighter elsewhere; the coverage table below says exactly which.

The codebase has strong security engineering in its core: a database-enforced exactly-once ledger, idempotency that fails closed, tenant-scoped v1 APIs, server-side role resolution, and hardened Router/Escrow contracts. Most money features are switched off in production behind capability gates.

The audit found **one P1**. The public account-funding route would have credited free testnet USDC as real balance once funding went live. That is now fixed. Three P2s and three P3s were found; five of those are fixed with regression tests that fail on the old code. Two P2s remain open because they need product or architecture decisions.

| Priority | Found | Fixed | Remaining |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 1 | 1 | 0 |
| P2 | 4 | 2 | 2 |
| P3 | 4 | 3 | 1 |
| P4 | 4 | 0 | 4 |

| Platform | P0 | P1 | P2 | P3 | P4 |
|---|--:|--:|--:|--:|--:|
| Web / Backend / API | 0 | 1 | 2 | 3 | 1 |
| Web3 (contracts) | 0 | 0 | 1 | 1 | 2 |
| Wear OS / Android | 0 | 0 | 1 | 0 | 0 |
| iOS | 0 | 0 | 0 | 0 | 0 |
| Chrome extension | 0 | 0 | 0 | 0 | 0 |
| Cloud / CI | 0 | 0 | 0 | 0 | 1 |

A zero means nothing was found in the depth reviewed, not that the platform is clean. See the coverage table.

## Coverage: what was reviewed, and how deeply

| Area | Depth | What was done |
|---|---|---|
| Account funding / x402 settlement | **Deep** | Traced request → verify (asset allowlist, payee) → settle (nonce claim, confirmations) → credit (effect key). Found SEC-P1-001. |
| Ledger / balance mutation | **Deep (app layer)** | `creditAccount`/`debitAccount`, effect-key construction at every caller, overdraft path. The SQL of `apply_financial_effect` was not re-read in this session. |
| Idempotency | **Deep** | Helper semantics (atomic claim, fails closed) and all 24 callers. Found and fixed SEC-P3-002. |
| Escrow (app + contract) | **Deep** | State machine and contract. Found SEC-P2-001, P2-003, P3-004. |
| Router / X402Facilitator contracts | **Deep (Router)** / sweep (X402Facilitator, compliance contracts) | Router: EIP-712, nonce namespace, deadlines, fee cap, reentrancy. Existing contract suite run (20 passing). |
| Sessions / refresh / revocation / roles | **Deep** | `session.ts`, refresh route, `requireRole`. Found SEC-P2-002. |
| Webhooks | **Sweep + targeted** | All 13 `WEBHOOK_VERIFIED` routes checked for signature, timestamp and dedupe; Telegram, Rain and escrow read. Found SEC-P3-001. Provider-specific signature code not re-derived per provider. |
| Cron auth | **Deep** | `requireCron`: fails closed, constant-time. Sound. |
| Public / ID-addressed routes | **Sweep + targeted** | 55 dynamic routes classified; public payment, receipt, disclosure and v1 read in full. Found SEC-P3-003. Remaining owner checks were matched by pattern, not read line by line. |
| P2P, cards, gifts, earn, investing | **Targeted** | P2P release read (sound; disabled in production). Others: idempotency binding only. |
| Wear OS | **Targeted** | Token handoff and paired-node gate. SEC-P2-004. |
| Chrome extension, React Native, iOS | **Not re-audited** | Covered by the internal audits of 2026-10-04 and 10-05 (`docs/audit/`), whose fixes are on this branch. Not independently re-verified here. |
| Cloud (Terraform) | **Sweep** | Wildcards, public CIDRs and bucket policy checked; deliberate and commented. Not applied anywhere. |
| CI / supply chain | **Sweep** | Action pinning (SEC-P4-001); npm audit earlier this session: 0 unaccepted high/critical after the `source-map-js` fix. |
| Secrets | **Sweep** | Tracked files: no private keys, live provider keys, cloud keys or committed `.env`. Git history and build artifacts not scanned in this session (CI gitleaks passed on the last runnable commit). |
| AI / agent (MCP, copilot) | **Not reviewed in this session** | Prior fixes exist (connector tokens cannot execute swaps). Recommended for the external audit. |

## Architecture and trust boundaries (summary)

Clients (web, React Native, iOS, Wear OS, extension, merchant SDKs, AI agents over MCP and signed agent keys) → Next.js API on Vercel (sessions in an HttpOnly cookie or Bearer, API keys for v1 tenants, OAuth for MCP) → Supabase Postgres (ledger and balances via `apply_financial_effect`) and Upstash KV (rate limits, nonces, idempotency, revocation) → external rails (EVM RPCs and the facilitator settler key, Stripe, Persona/Sumsub, Rain, Resend, Telegram/Discord) → contracts (Router, Escrow, X402Facilitator; not deployed).

Single points of failure observed:

- **Upstash KV.** It is down in production now. Rate limits and idempotency fail closed (safe), but session revocation fails open (SEC-P2-002) and lead capture stops (SEC-P4-003).
- **The facilitator settler key** and the **escrow oracle key.**

## Fixes applied

| Finding | Commit | Test (fails on old code) |
|---|---|---|
| SEC-P2-001 escrow state machine | `3db7fcc` | `apps/web/src/lib/services/__tests__/escrowStateMachine.spec.ts` |
| SEC-P3-001 Telegram constant-time secret | `3db7fcc` | `apps/web/src/app/api/telegram/webhook/__tests__/telegramWebhookAuth.spec.ts` |
| SEC-P1-001 no testnet funding in production | `3a9c00a` | `apps/web/src/app/api/account/fund/__tests__/fundTestnet.spec.ts` |
| SEC-P2-003 escrow release not before check-in | `3a9c00a` | `packages/contracts/test/furlpay.test.ts` |
| SEC-P3-003 public receipt minimised | `3a9c00a` | `apps/web/src/app/api/payments/[id]/receipt/__tests__/publicReceipt.spec.ts` |
| SEC-P3-002 idempotency bound to request | `516d875` | `apps/web/src/lib/__tests__/idempotencyRequestBinding.spec.ts` |

## Remaining risks and decisions needed

1. **SEC-P2-002.** Choose how refresh behaves when revocation status is unknown, and restore Upstash.
2. **SEC-P2-004.** Design a scoped watch token.
3. **SEC-P3-004.** Change the escrow booking-id scheme before any deployment.
4. **Contracts are unaudited and undeployed**, and the Solana program does not build (SEC-P4-004).
5. **Not covered here:** AI/agent surface; extension, mobile and iOS re-verification; git-history secret scan; per-provider webhook signature derivation; the SQL of the ledger functions.

## Recommended external audit scope

Prioritised by the audit's own findings and the scoping pack:

1. **Smart contracts:** Router, Escrow, X402Facilitator and the compliance contracts (≈855 SLOC), plus the Solana escrow (310 SLOC, after it builds). Formal verification candidates: Router `_execute` (a payer's balance decreases by exactly `amount`, a nonce is used at most once per payer, fee ≤ 1%) and Escrow (each booking pays out exactly once, to the traveler or the provider).
2. **Payment and ledger:** `apply_financial_effect` / `ledger_post` SQL, x402 facilitator and settler, account funding, payouts.
3. **Pen test:** web/API (auth, sessions, OAuth/MCP, v1 tenant isolation), the browser extension, React Native/iOS, Wear OS phone↔watch.
4. **Cloud:** Terraform IAM before first apply; Vercel and Supabase configuration.
5. **AI/agent abuse cases:** MCP tools, agent keys, copilot actions.
6. **AML/KYT:** current screening (Circle Compliance) against what the MiCA/US rails require.

External audit readiness: **not ready** for contracts (unaudited, Solana does not build, booking-id scheme pending). **Ready to scope** for web/API, given the scoping pack.
