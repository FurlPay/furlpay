# Fiat provider integration (banking, on-ramp, off-ramp, payouts)

**Status: PORTS EXIST, NO PROVIDER, NOT LIVE.** `BANKING_LIVE`, `ONRAMP_LIVE` and `OFFRAMP_LIVE` all carry `unimplemented` reasons in `apps/web/src/lib/flags.ts`. The provider capability matrix (`apps/web/src/lib/providers/capability.ts`) has no row with `contractStatus: "live"`, so provider selection finds nothing even if a flag were forced.

**Everything in this document that moves fiat requires a regulated external partner.** FurlPay cannot reach UPI/IMPS/NEFT/RTGS, ACH, SEPA or card-funded on-ramps directly; those run through a bank or a licensed aggregator holding customer funds.

## 1. What exists

| Piece | Where |
|---|---|
| Banking port | `BankingProviderAdapter` — `createCollectionReference`, `verifyIncomingPayment` (pull, not push), `createBeneficiary`, `payout`, `getPayoutStatus`, `getStatement`, `verifyWebhook` |
| On-ramp port | `OnrampProviderAdapter` — `quote`, `createOrder`, `getStatus`, `cancel`, `refund`, `verifyWebhook` |
| Off-ramp port | `OfframpProviderAdapter` — `quote`, `createOrder`, `notifyDeposit`, `getStatus`, `cancel`, `verifyWebhook` |
| Outcome type | `ProviderOutcome` — the adapter reports what the provider said; "unknown" is a real state, never coerced to failed |
| Selection | `lib/providers/router.ts` + `capability.ts` — a provider is selectable only with `contractStatus: "live"`, evidence, and credentials |
| State machine | `lib/paymentStateMachine.ts` — explicit FSM; terminal states have no outgoing edges; illegal transitions throw |
| Rails | `lib/rails/registry.ts`, `lib/rails/india/*`, `lib/rails/singapore/*` |
| Webhooks | `lib/withDurableWebhook.ts` (in the uncommitted change set) + per-provider HMAC verification (AGENTS rule 3) |
| Idempotency | `lib/idempotency.ts` — `withIdempotency(key, scope, fn, { principal })` |
| Beneficiary safety | `Beneficiary.verification` is `penny_drop` / `name_match` / `unverified`; the orchestrator refuses to pay `unverified` |
| Routes | `api/banking` (503, "no VAN provider"), `api/offramp` (503 when not configured), `api/onramp/*`, `api/payouts/*` |

## 2. State machine requirements (brief) vs today

| Requirement | Today |
|---|---|
| created → pending → processing → completed / failed / reversed / cancelled | `PaymentState` + events `SUBMIT, BROADCAST, CONFIRM, FAIL, REVERSE, EXPIRE` (`paymentStateMachine.ts`) |
| Server-side transitions only | Yes — routes transition; the client never sends a state |
| Idempotency | `withIdempotency`, per-principal scope |
| Webhook signature + replay | HMAC over raw body, constant-time, timestamp window; durable dedupe in the uncommitted webhook work |
| Reconciliation | `lib/reconciliation.ts`, `api/cron/reconcile`; `getStatement` on the banking port is the source of truth for bank-side reconciliation |
| Immutable audit events | `lib/audit.ts`, `lib/auditDb.ts` |
| Duplicate-payment protection | idempotency keys + unique provider refs |
| Transaction limits | `lib/moneyLimits.ts` |
| Authorisation | `requireUser` + owner scoping on every route |

## 3. What a provider adapter must do

1. Implement the relevant port **without** widening any type to accept unverified data.
2. `verifyWebhook` throws `WebhookVerificationError` on a bad signature; the route fails closed when the secret is unset.
3. Report provider uncertainty as uncertainty (`ProviderOutcome`), never as failure — a timed-out payout may have been sent.
4. Pass FurlPay's idempotency key through to the provider.
5. Never pay a beneficiary whose `verification` is `unverified`.
6. Register its credentials in `lib/env.ts` and `.env.example` (AGENTS rule 10).

## 4. To go live — external

1. **Regulated partner contract** (bank / payment aggregator / on-ramp / off-ramp provider) per corridor — **BLOCKED_EXTERNAL**.
2. Licensing review per jurisdiction (e.g. RBI PA/PA-CB for India, MAS for Singapore, state MTLs / FinCEN for the US) — **BLOCKED_EXTERNAL**.
3. Capability row with `contractStatus: "live"` and an evidence URL.
4. Production credentials.
5. Delete the flag's `unimplemented` reason in the same change as the adapter.
6. Observed production transaction → then, and only then, `lib/productionStatus.ts`.
