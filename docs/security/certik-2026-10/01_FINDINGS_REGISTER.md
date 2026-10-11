# 01 — Findings register (F-1 … F-42)

Source: the internal pre-engagement assessment dated 11 October 2026 (static
review, 42 findings). Every finding was checked against the code on branch
`security/certik-remediation-oct11`, based on the production release commit
`0dce509b` (PR #113). The report was found to be partly stale: several
findings describe code that had already been rewritten.

Status values: **REMEDIATED** (changed on this branch, with a regression
test), **ALREADY FIXED** (the code at `0dce509b` already did this),
**ACCEPTED RISK**, **NOT A VULNERABILITY**, **FALSE POSITIVE**,
**NOT PRODUCTION-REACHABLE**, **BLOCKED** (needs something outside the
repository), **PARTIAL**, **INFO**.

"Prod-reachable" means reachable from https://furlpay.com at `0dce509b`.
None of the remediation below is deployed; see 09_REMAINING_RISKS.md.

| ID | Report sev. | Validated | Prod-reachable | Status | Evidence / remediation | Commit | Test |
|---|---|---|---|---|---|---|---|
| F-1 | Low | Low | No — router not deployed | ACCEPTED RISK | `setFeeTreasury` is single-step by design: the Arc incident runbooks (`docs/ARC-DEPLOYMENT-ARCHITECTURE.md` A3) rely on an immediate rotation when the treasury is blocklisted; a timelock would turn that into an outage. Control: the router owner must be a multisig at deployment. | — | — |
| F-2 | Info | Info | No | INFO | Batch atomicity confirmed in `FurlPayRouter.batchPay`; documented product decision. | — | existing router tests |
| F-3 | Medium | Low | No — escrow not deployed | ACCEPTED RISK | A compromised oracle can only release a booking early, and only to the booking's recorded provider, never to an arbitrary address; the traveller loses the cancellation window. `checkInOracle` may be a multisig and `releaseAfterGrace` is permissionless. Control: deploy with a multisig oracle. | — | — |
| F-4 | Low | Low | No | ACCEPTED RISK | Full-refund-only cancellation is the escrow's documented rule; a penalty schedule is a product change. | — | — |
| F-5 | Low | — | — | FALSE POSITIVE | `uint64` seconds overflow in roughly 584 billion years. The year-2106 limit belongs to `uint32`. | — | — |
| F-6 | Medium | Medium | No — not deployed | REMEDIATED | `PolicyManager.addCheck` now refuses past `MAX_CHECKS = 16` and refuses duplicates. | `bb2b3b4e` | `compliance.test.ts` "PolicyManager bounds (audit F-6)", 4 tests incl. gas bound |
| F-7 | Medium | Low | No | REMEDIATED | The public development secret was gated on `NODE_ENV` alone; it is now also refused on any hosted runtime (`VERCEL_ENV`, AWS Lambda, ECS). Local development unchanged. | `2183d9e6` | `sessionSecretHosted.spec.ts` (7) |
| F-8 | Low | Low | Yes (`/api/wallets/transfer`) | REMEDIATED | `deviceSignals` was `z.record(z.any())`; now bounded keys, primitive values, capped strings and arrays, one nesting level. | `d524373b` | `deviceSignalsSchema.spec.ts` (6) |
| F-9 | Info | Info | — | INFO | Per-instance limiter fallback during a Redis outage is documented; money and SMS buckets fail closed. | — | existing |
| F-10 | High | High | Yes | REMEDIATED (body bound) / PARTIAL (Zod) | 59 route files used `req.json()`, 7 `req.text()`, 4 `req.formData()`, and `validateBody` itself read the full text before measuring. All now read through a streamed 100 KB bound (`readJsonBody` / `readTextBody` / `readFormBody`). Zod coverage: 45 of 236 mutating route files still validate by hand (list in 09). | `1edd394b` | `apiBodyCap.spec.ts` (5 MB chunked body abandoned near the cap; zero unbounded reads in route code) |
| F-11 | Low | — | — | ALREADY FIXED | No default quote secret; production requires `X402_QUOTE_SECRET` (`lib/x402QuoteSecret.ts`); `/api/x402/price` answers 503 without it. | — | existing |
| F-12 | Medium | — | — | ALREADY FIXED | `kvSetNx` refuses the in-memory fallback in production and throws on any Redis failure, so x402 single-use claims fail closed. The x402.ts comment describing a fallback is stale. | — | `kv` specs |
| F-13 | High | High | Yes (`/api/agents/ap2`) | REMEDIATED | Single-use mandates were stored in a per-instance `Set`. Claims are now one Redis `SET NX` per nonce, kept until mandate expiry; intents valid > 30 days are refused; store unavailable → 503; a refused cart consumes no nonce. Body now validated with strict Zod. | `0382ad3a` | `ap2Replay.spec.ts` (7, incl. 12 concurrent presentations across 4 instances → 1 authorization); package tests (7 F-13) |
| F-14 | Medium | Medium | Yes | REMEDIATED | Cap compared with a 1e-9 epsilon, line sum rounded with 0.01 slack, settlement built with `Math.round`. All exact in integer atomic units; finer-than-6dp, negative, zero and non-finite amounts refused. | `0382ad3a` | package tests (7 F-14) |
| F-15 | High | — | — | ALREADY FIXED | Placeholder config replaced by build-time `extra.freerasp`; `app.config.js` refuses a release build without `FURLPAY_FREERASP_CERT_HASHES`. | — | `tamperDetection` tests |
| F-16 | High | — | — | ALREADY FIXED | Same mechanism for the Apple Team ID (validated `^[A-Z0-9]{10}$`). | — | as above |
| F-17 | Medium | Medium | Mobile | BLOCKED | Device attestation reports `not_configured` honestly; server-side Play Integrity / App Attest verification needs a Google Cloud project, Apple configuration and physical devices. | — | — |
| F-18 | Medium | — | — | ALREADY FIXED | freeRASP start failure marks integrity unknown → step-up on money moves, never silent allow. | — | `riskEngine` tests |
| F-19 | Low | — | — | ALREADY FIXED | `AppDelegate.swift` subscribes to `protectedDataWillBecomeUnavailable` and calls `evictCache()`. | — | — |
| F-20 | Medium | Medium | Card program | BLOCKED | Card velocity/limits are constants. Per-account policy needs a compliance-approved design; not invented here. | — | — |
| F-21 | Medium | Low | No callers | REMEDIATED (guard) | The "MPC" returns an HMAC digest padded to 65 bytes. No caller exists; both functions now throw in production. Real MPC/Turnkey integration is BLOCKED on the provider. | `9606ae36` | `packages/security` test (1) |
| F-22 | Low | — | — | NOT A VULNERABILITY | The only secret-sounding public variable is `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, public by design. | — | `envRegistry.spec.ts` |
| F-23 | Info | Info | — | INFO | viem's recovery validates `v`. | — | — |
| F-24 | High | Medium | No — only callers are production-gated booking flows | NOT PRODUCTION-REACHABLE / BLOCKED | `SOLANA_PAYER_SECRET` is used only to pay fees for cNFT ticket mints from `/api/travel/book` and `/api/actions/book-car`, both refused in production before the mint. Action: remove it from the Vercel production scope (approval needed). Managed signing (Turnkey/KMS Ed25519) blocked on provider credentials. | — | — |
| F-25 | Medium | Low | AWS path not deployed | INFO | One Next.js middleware enforces body cap, CSRF, rate limit and origin verification on both paths; the AWS path is not deployed. | — | — |
| F-26 | Low | — | — | NOT A VULNERABILITY | Two channels by design (Vercel Cron Bearer vs external scheduler header), each secret accepted only on its own header, constant-time, fail closed when unset. | — | `cron` specs |
| F-27 | Medium | — | — | ALREADY FIXED | Node SDK uses `timingSafeEqual` after a length check, with timestamp tolerance. | — | — |
| F-28 | Low | — | — | ALREADY FIXED | `TransferSchema.amount` is `MoneyAmount` with `.max(MAX_MONEY_AMOUNT)`. | — | — |
| F-29 | Info | — | — | ALREADY FIXED | See F-37. | — | — |
| F-30 | Low | — | — | NOT A VULNERABILITY | `MAX_KEYS = 50 000` with stale eviction. | — | — |
| F-31 | Info | Info | — | INFO | Version header is tolerated and echoed; it plays no part in authentication. | — | — |
| F-32 | Low | Medium | Yes (every x402 402) | REMEDIATED | XSGD priced at a hardcoded 0.78 when unset. No default now; offered only with a configured rate in 0.5–1.0, otherwise USDC only. | `658b8bea` | `x402XsgdRate.spec.ts` (4) |
| F-33 | Medium | Medium | Mobile | BLOCKED | Same as F-17. | — | — |
| F-34 | Info | Info | — | INFO | Confirmed. | — | — |
| F-35 | Low | — | — | NOT A VULNERABILITY | `PerTxCapUpdated(cap)` carries the value; NatSpec defines 0 = disabled. | — | — |
| F-36 | Info | Info | — | INFO | v1/v2 dialects both go through the same binding and replay checks. | — | x402 specs |
| F-37 | Medium | — | — | ALREADY FIXED | Revocation "unknown" (KV down) restricts the session to read-only methods (`lib/authz.ts`). | — | `authz` specs |
| F-38 | Low | Low | Yes | REMEDIATED | Fixed with F-10: the streamed bound ignores Content-Length. | `1edd394b` | `apiBodyCap.spec.ts` ("lying Content-Length") |
| F-39 | Info | Info | iOS | INFO | Nine SPKI pins; a rotation plan is required before 2027. | — | — |
| F-40 | Low | Low | Card program | BLOCKED | With F-20: the MCC list must come from compliance. | — | — |
| F-41 | Medium | — | No callers | NOT PRODUCTION-REACHABLE | `packages/security` `assessRisk` has no caller; the mobile app uses its own rule-based engine. | — | — |
| F-42 | Low | Low | Yes (support) | REMEDIATED | Bare hex kept on purpose; hex labelled as a key is now redacted. | `190c3e79` | `redactLabelledKey.spec.ts` (10) |

## Adjacent findings (not in the report)

| ID | Finding | Status |
|---|---|---|
| A-1 | `/api/agents/ap2` accepted an unvalidated body. | REMEDIATED with F-13 (`0382ad3a`). |
| A-2 | `validateBody` read the full text before measuring it. | REMEDIATED with F-10 (`1edd394b`). |
| A-3 | 11 routes read `req.text()` / `req.formData()` unbounded, including webhooks. | REMEDIATED with F-10 (`1edd394b`). |
| A-4 | `mintTicketCnft` returns a fabricated "mock" asset id on failure. | INFO: both callers are refused in production. |
| A-5 | `/api/travel/book` derives a `txHash` from proof digits. | INFO: route refused in production before this point. |

## Tally

| Status | Count | IDs |
|---|---|---|
| Remediated on this branch | 10 | F-6, F-7, F-8, F-10, F-13, F-14, F-21, F-32, F-38, F-42 |
| Already fixed at `0dce509b` | 10 | F-11, F-12, F-15, F-16, F-18, F-19, F-27, F-28, F-29, F-37 |
| Accepted risk (with a deployment condition) | 3 | F-1, F-3, F-4 |
| False positive | 1 | F-5 |
| Not a vulnerability | 4 | F-22, F-26, F-30, F-35 |
| Not production-reachable | 2 | F-24, F-41 |
| Blocked on an external dependency | 4 | F-17, F-20, F-33, F-40 |
| Informational | 8 | F-2, F-9, F-23, F-25, F-31, F-34, F-36, F-39 |
| **Total** | **42** | |

Of the five High findings: F-10 and F-13 are remediated (F-10's Zod coverage
remains partial), F-15 and F-16 were already fixed, and F-24 is not reachable
in production but needs the key removed from the production environment.
Nothing on this branch is deployed. On 11 October production served `d3d7422e`;
the merged release `0dce509b` was awaiting its production deploy.
