# FurlPay security invariants

Each invariant names where it is enforced and the test that holds it. "Gap" marks an invariant that is not yet fully enforced; see SECURITY-AUDIT-FINDINGS.md.

## Identity and isolation

| Invariant | Enforced by | Evidence |
|---|---|---|
| A user reads and mutates only their own resources | `requireUser` + owner checks in services (e.g. escrow `ownedHold`, P2P `getOrder`/`roleInOrder`) | `escrowStateMachine.spec.ts` (user B vs user A's hold) |
| A tenant cannot reach another tenant's payments | `v1` routes query by `tenant.organizationId`; foreign ids are 404, not 403 | `app/api/v1/payments/[id]/route.ts` |
| Admin cannot be obtained from user-controlled input | `requireRole` uses roles from the stored account, not token claims; `admin` also needs the bootstrap email; guests never admin in production | `lib/authz.ts` |
| Sessions are signed with a strong secret, HS256 pinned | `lib/session.ts` (refuses a weak or dev secret in production) | existing session tests |
| A revoked session stays revoked | in-memory + KV denylist; account epoch for "log out everywhere" | **Gap**: SEC-P2-002 (KV outage + refresh) |

## Money

| Invariant | Enforced by | Evidence |
|---|---|---|
| No credit without a real-money source | `/api/account/fund`: treasury payee, asset allowlist, mainnet-only in production | `fundTestnet.spec.ts` (SEC-P1-001) |
| A financial effect applies at most once | `apply_financial_effect` (migration 0025): one transaction, effect key unique | `creditAccount`/`debitAccount` effect keys from provider facts or `user:key` |
| A user cannot spend more than their balance | overdraft check under a row lock in the database function | `debitAccount` maps to `insufficient_balance` |
| A retry cannot cause another effect, and a reused key cannot carry a different request | `withIdempotency` (atomic claim, fails closed on KV error) + `request` binding | `idempotencyRequestBinding.spec.ts` (SEC-P3-002) |
| A settled x402 nonce cannot settle again | `kvSetNx` claim on the nonce before submission; claim records the resource | `lib/x402Facilitator.ts` |
| Escrow holds move only `held → captured \| released \| expired` | `lib/services/escrow.ts` | `escrowStateMachine.spec.ts` (SEC-P2-001) |

## Webhooks

| Invariant | Enforced by |
|---|---|
| Provider events are signature-verified and timestamp-checked | every `WEBHOOK_VERIFIED` route; Rain returns 501 until its real scheme is known |
| One event produces one financial effect | `claim_webhook_event` (migration 0022/0024) on financial webhooks (card-auth, deposit-detect, furlbridge, persona, stripe, sumsub, resend) |
| Shared secrets are compared in constant time | `timingSafeEqual` (cron, Telegram: SEC-P3-001) |

## Blockchain

| Invariant | Enforced by |
|---|---|
| Signatures are chain- and contract-bound | EIP-712 domain separator (`FurlPayRouter`), EIP-3009 domain from our own asset registry |
| A nonce is consumable only by its signer, once | `FurlPayRouter.usedNonces[payer][nonce]`, set after signature recovery |
| Recipient and asset are validated before settlement | facilitator asset allowlist + payee match; `account/fund` treasury check |
| Escrow cannot be released before check-in | `FurlPayEscrow.confirmCheckIn` (SEC-P2-003) |
| Privileged contract functions are owner-only, two-step ownership | `Ownable2Step` on Router and Escrow |
