# Security audit findings register

Audit of branch `security/full-audit-2026-10-06` (from `codex/cross-platform-audit` @ `86656d9`), 2026-10-06.
Severity: P0 critical · P1 high · P2 medium · P3 low · P4 informational/hardening.
Status: **Fixed** (code changed, regression test fails on the old code and passes now) · **Open** (not fixed; reason given) · **Accepted** (documented trade-off).
Evidence level: **Confirmed** (traced in code and/or demonstrated by a test) · **Probable** · **Potential**.

| ID | Pri | Title | Platform | Status |
|---|---|---|---|---|
| SEC-P1-001 | P1 | Testnet USDC could be credited as real account balance | Backend / Web3 | Fixed |
| SEC-P2-001 | P2 | Escrow hold state machine: release after capture, double release, action after expiry | Backend | Fixed |
| SEC-P2-002 | P2 | Revoked session can be refreshed into a fresh, unrevoked token while KV is down | Backend / Auth | Open (decision) |
| SEC-P2-003 | P2 | Escrow oracle could release a booking inside the cancellation window | Web3 (Solidity) | Fixed |
| SEC-P2-004 | P2 | Wear OS watch holds the phone's full-power session token | Wear OS / Android | Open (architecture) |
| SEC-P3-001 | P3 | Telegram webhook secret compared with `!==` (timing) | Backend | Fixed |
| SEC-P3-002 | P3 | Idempotency-Key not bound to the request body on 16 money routes | Backend / API | Fixed |
| SEC-P3-003 | P3 | Public payment receipt exposed payer and merchant metadata | Backend / API | Fixed |
| SEC-P3-004 | P3 | Escrow `bookingId` is caller-chosen: front-run griefing | Web3 (Solidity) | Open (interface change) |
| SEC-P4-001 | P4 | First-party GitHub Actions pinned by tag, not SHA | CI/CD | Open |
| SEC-P4-002 | P4 | Router fee treasury is owner-mutable after payers sign | Web3 (Solidity) | Accepted (documented) |
| SEC-P4-003 | P4 | KV outage: fail-closed limits make report-download leads unrecordable | Backend / Ops | Open (operational) |
| SEC-P4-004 | P4 | Solana escrow `declare_id!` is not valid base58; program cannot build | Web3 (Anchor) | Open (known) |

---

## SEC-P1-001 — P1 — Testnet USDC could be credited as real account balance

- **Platform:** Backend/API, Web3 · **Status:** Fixed · **Evidence:** Confirmed (code trace + regression test)
- **CWE:** CWE-345 (Insufficient verification of data authenticity), CWE-840 (Business logic) · **CVSS 3.1 (when funding is live):** 8.1 AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H
- **Location:** `apps/web/src/app/api/account/fund/route.ts` `POST`; enablers `lib/x402Facilitator.ts` (`NETWORKS` includes `arbitrum-sepolia`), `lib/x402Assets.ts` (Circle testnet USDC on the settlement allowlist), `lib/x402Chains.ts` (falls back to viem's public Sepolia RPC).
- **Description:** `/api/account/fund` is unauthenticated by design ("auth is the x402 payment"). It checks the payee is FurlPay's treasury and keys the credit to the settled EIP-3009 authorization, but it credited the settled amount as USD **whatever network it settled on**. The facilitator verifies and settles Arbitrum Sepolia, and testnet USDC is free from Circle's faucet.
- **Security impact:** with funding live (`INTEGRATION_MODE=live` and a settler key with Sepolia gas), anyone mints spendable USD balance into any account (`destinationUserId`) for free.
- **Business impact:** direct financial loss once balance is spendable on cards, payouts or bookings; ledger integrity.
- **Preconditions:** production funding enabled; settler key funded on Sepolia. Today production refuses funding (`funding_unavailable`), so it is **not currently reachable** in production.
- **Attack scenario:** take faucet USDC on Arbitrum Sepolia → sign a `transferWithAuthorization` to `PAY_TO` → `POST /api/account/fund` with `network: "arbitrum-sepolia"` and the Sepolia USDC asset → verify passes, the settler submits on Sepolia, the route credits USD.
- **Root cause:** the money-in path trusted "settled" without asking "settled on a real-money network".
- **Fix applied:** in the production financial environment the route refuses any network that viem marks `testnet` (and any unknown network) with `400 network_not_accepted`, **before** `settle()`, so no testnet authorization is ever submitted on this path. Staging and development still accept testnets.
- **Test:** `apps/web/src/app/api/account/fund/__tests__/fundTestnet.spec.ts` (6 tests; 4 fail against the previous route).
- **Residual risk:** the generic facilitator (`/api/x402/facilitator/settle`) still settles testnets for third parties, which is intended. Any future route that turns a settlement into balance must apply the same rule.

## SEC-P2-001 — P2 — Escrow hold state machine accepted invalid transitions

- **Platform:** Backend · **Status:** Fixed · **Evidence:** Confirmed · **CWE:** CWE-841 (Improper enforcement of behavioral workflow)
- **Location:** `apps/web/src/lib/services/escrow.ts` `releaseHold`, `captureHold`; caller `app/api/escrow/route.ts`.
- **Description:** `releaseHold` had no state check. A `captured` hold could be released (status → `released`, `capturedAmount` → 0, and the route reported the full authorization as refunded to the Safe after the merchant had been paid). A hold could be released twice, and a hold past its TTL could still be captured until a listing lazily expired it.
- **Impact:** inconsistent hold and transaction records; a "refund" of money already captured. Production refuses to create holds (in-memory store, `EscrowDurabilityError`), so it is limited to staging and development today.
- **Fix applied:** holds move only `held → captured | released | expired`; both actions expire a due hold first and act only on a live `held` hold; capture requires a positive amount.
- **Test:** `apps/web/src/lib/services/__tests__/escrowStateMachine.spec.ts` (6 tests, including user B acting on user A's hold; 4 fail against the old service).

## SEC-P2-002 — P2 — Revoked session can be refreshed into an unrevoked token while KV is down

- **Platform:** Backend/Auth · **Status:** Open (needs a product decision) · **Evidence:** Confirmed by code trace · **CWE:** CWE-613 (Insufficient session expiration)
- **Location:** `apps/web/src/lib/session.ts` `verifySession` (durable revocation check fails **open** on a KV error, by design); `app/api/auth/refresh/route.ts` (re-mints with a **new jti**).
- **Description:** logout revokes a token's `jti` in memory and in KV. If KV is unavailable (production KV has been over quota since 2026-10-02), the revoked token still passes `requireUser` on any other instance, and `/api/auth/refresh` exchanges it for a new token whose jti was never revoked. That session then survives logout until the 30-day refresh ceiling, even after KV recovers. "Log out everywhere" (session epoch, stored durably on the account) is not affected.
- **Preconditions:** a stolen or logged-out token, plus a KV outage (current reality).
- **Why not fixed here:** the direct fix (refuse refresh when revocation status is unknown) signs every user out hourly for as long as KV is down. That is a product and availability trade-off.
- **Recommended fix (choose one):** (a) fail closed on refresh only, and restore KV; (b) also record single-session revocations durably in Supabase (which is up) and check that on refresh; (c) make logout bump the account epoch when KV is unavailable.

## SEC-P2-003 — P2 — Escrow oracle could release inside the cancellation window

- **Platform:** Web3 (Solidity) · **Status:** Fixed · **Evidence:** Confirmed (Hardhat test) · **CWE:** CWE-841, centralization risk
- **Location:** `packages/contracts/contracts/FurlPayEscrow.sol` `confirmCheckIn`.
- **Description:** `confirmCheckIn` checked only `msg.sender == checkInOracle`. The oracle could pay the provider at any time, including before the traveler's `cancellationDeadline` (or by front-running a `cancel`), removing the refund right. A compromised oracle key could release every funded booking early.
- **Fix applied:** reverts `CheckInNotReached(checkInDate)` before `checkInDate`. Because `createBooking` enforces deadline ≤ check-in, the window has always closed by then.
- **Test:** `packages/contracts/test/furlpay.test.ts` "the oracle cannot release before check-in…" (fails on the old contract; the existing check-in test now advances time to check-in, matching real use). 20 passing.
- **Residual risk:** the oracle is still a single key after check-in (centralization); the contracts are unaudited and not deployed.

## SEC-P2-004 — P2 — Wear OS watch holds the phone's full-power session token

- **Platform:** Wear OS / Android · **Status:** Open (architecture) · **Evidence:** Confirmed by code trace · **CWE:** CWE-272 (Least privilege violation)
- **Location:** `guardian/app/mobile/.../SyncCoordinator.kt` `pushToken` → persistent DataItem `/guardian/auth-token`; `guardian/app/wear/.../WearListenerService.kt`.
- **Description:** the watch receives the same bearer token the phone uses for money movement. Mitigations already in place: the token is accepted only from a connected paired node (`PairedNodeGate`), sign-out pushes an empty token, watch actions are pinned in `GuardianActionRegistry`, and money-moving actions require biometric step-up on the phone.
- **Recommended fix:** mint a scoped, short-lived, read-only watch token server-side and deliver it over `MessageClient` rather than a persistent DataItem.

## SEC-P3-001 — P3 — Telegram webhook secret compared with `!==`

- **Status:** Fixed · **CWE:** CWE-208 (Observable timing discrepancy) · **Location:** `app/api/telegram/webhook/route.ts`.
- Impact is low: the bot answers read-only commands, and a forged update's reply goes back to the forger in the HTTP response. Fixed with SHA-256 + `timingSafeEqual`; fails closed when unset. Test: `telegramWebhookAuth.spec.ts` (3).

## SEC-P3-002 — P3 — Idempotency-Key not bound to the request body

- **Status:** Fixed · **CWE:** CWE-694/CWE-841 · **Location:** 16 routes under `app/api` (wallets/transfer, earn, investing, gifts, cards, p2p, billing, membership, account/spend).
- `withIdempotency` refuses a reused key with a different body only when the route passes `request`; these did not. A second transfer reusing a key was answered with the first transfer's cached success. That is never a second money movement, but the client was told something false. Each route now passes its validated body. Guard test `lib/__tests__/idempotencyRequestBinding.spec.ts` requires every caller to bind, or be listed with a reason (4 listed); it fails on the old routes.

## SEC-P3-003 — P3 — Public payment receipt exposed payer and merchant metadata

- **Status:** Fixed · **CWE:** CWE-200 · **Location:** `app/api/payments/[id]/receipt/route.ts`.
- Unauthenticated (the 96-bit payment id is a capability link). `publicPaymentView` deliberately withholds identities from link holders; the receipt returned `payer` and the merchant's free-form `metadata`. Both removed (no client consumed them). Test: `publicReceipt.spec.ts` (fails on the old route).

## SEC-P3-004 — P3 — Escrow `bookingId` is caller-chosen (front-run griefing)

- **Status:** Open (needs an interface change) · **Location:** `FurlPayEscrow.createBooking`.
- An observer of a pending `createBooking` can fund the same `bookingId` first with a 1-unit booking; the traveler's transaction reverts `BookingExists` and the receipt NFT for that id is minted to the attacker. Recommended: key bookings by `keccak256(msg.sender, bookingId)`, or have the backend issue signed booking ids. Not deployed, so no live exposure.

## SEC-P4 items

- **SEC-P4-001:** `actions/*` and `github/codeql-action` are pinned by tag; third-party actions are already SHA-pinned. Pin first-party actions by SHA too (Scorecard).
- **SEC-P4-002:** `FurlPayRouter.setFeeTreasury` lets the owner redirect future fees; signatures bind the fee amount, not its destination. Documented owner power; consider a timelock.
- **SEC-P4-003:** with Upstash over quota, every fail-closed rate-limit bucket (e.g. `content.report_download`) answers 503. The report dialog then downloads the PDF without recording the lead. Restore KV, or alert on `storeUnavailable`.
- **SEC-P4-004:** `furlpay-programs/.../lib.rs` `declare_id!("FurlPay111…")` contains `l`, which is not base58, so the Anchor program cannot be built or deployed as committed. Known from the internal audit of 2026-10-05; re-confirmed.
