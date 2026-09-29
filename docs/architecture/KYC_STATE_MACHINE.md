# FurlPay — KYC State Machine

_2026-09-29. The actual KYC model and the transition guard added this pass._

## Actual model (from `apps/web/src/lib/store.ts`)

- `kycStatus: "unverified" | "pending" | "verified"` — 3 states.
- `kycTier: 0 | 1 | 2 | 3` — limit/feature tiers (`lib/kycTiers.ts`: `tierLimits`, `checkTransferAmount`, `checkFeature`).
- Mutated via `setKycStatus(userId, status, tier?)`, called by the admin dev path and the Stripe webhook.
- `kycTier` is allow-listed out of user-updatable fields — a user cannot self-escalate.

> The reference report's 7-state model (UNVERIFIED/PENDING/REVIEW/APPROVED/REJECTED/EXPIRED/RESTRICTED) is **not** this system. We document and guard the states that exist rather than inventing new ones.

## The gap this pass addresses

`setKycStatus` accepted **any** status → any status. A bug or a compromised admin path could jump a user straight to `verified` (skipping the provider decision) or silently downgrade a `verified` user, with no central rule saying which moves are legal.

## Transition guard (`lib/kycStateMachine.ts`) — pure, tested

```
unverified ──▶ pending          user starts verification
pending    ──▶ verified         provider approved
pending    ──▶ unverified       provider rejected / abandoned
verified   ──▶ unverified       revoked / expired (the only exit from verified — explicit)
verified   ──▶ pending          re-verification (e.g. document expiry)

FORBIDDEN: unverified ──▶ verified   (skips the provider decision)
no-op (from === to) is always allowed (idempotent)
```

API: `canTransitionKyc(from, to): boolean`, `assertKycTransition(from, to)` (throws `KycTransitionError`).

## Status

- **Implemented + tested** (`kycStateMachine.spec.ts`): the transition table + guard.
- **Not yet wired** into `setKycStatus`: deliberate. The Stripe webhook and admin dev path both call `setKycStatus`, and must be verified against the table (and given a legitimate `unverified→verified` route via `pending`) before the guard is enforced, or a legitimate flow could start throwing. Wiring + flow tests = the P2 follow-up.
- **Provider abstraction:** Persona / Sumsub / ComplyAdvantage each have isolated webhook handlers today; a formal `KycProvider` interface is a future refactor only if provider logic starts leaking into business code (it currently does not warrant it).

## Rule
Financial/card eligibility derives from the authoritative server-side `kycStatus`/`kycTier`, never a client-provided value.
