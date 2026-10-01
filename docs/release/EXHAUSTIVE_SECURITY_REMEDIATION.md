# Exhaustive security remediation: 2026-09-30

This pass covered security, financial correctness, identity isolation and production hardening.

Nothing here is committed or deployed. "VERIFIED" means proven by an executable test in this tree: a vitest spec, or the real-PostgreSQL harness `scripts/db/verify-financial-effects.mjs` on embedded PostgreSQL 18. It never means proven in staging or production. Every finding marked FIXED has a test. Mutation checks, where one was run, are noted in the row.

Status vocabulary: FIXED · VERIFIED · BLOCKED_EXTERNAL · UNVERIFIED · ACCEPTED · REMAINING.

## Findings

| ID | Severity | Area | Finding | Evidence | Fix | Test | Status |
|---|---|---|---|---|---|---|---|
| ES-01 | P1 | Identity | A database error during login fell through to "no such user" and minted a new, empty account (a phantom identity; the next login split again) | `findOrCreateUserByIdentityDurable` treated a thrown lookup as a miss | Lookup errors raise `IdentityUnavailableError`; nothing is created | `identityCanonical.spec.ts` "a database outage during login throws" (mutation-checked) | FIXED, VERIFIED |
| ES-02 | P1 | Identity | After an email or phone change, the OLD key still resolved to the account. Whoever next controlled the old mailbox or number signed into it | `updateUser` never removed the old index entries | `updateUser` drops the stale email/phone/googleSub/appleSub keys it owns (`dropIfMine`) | `identityCanonical.spec.ts` "identity change" (2 tests) | FIXED, VERIFIED |
| ES-03 | P2 | Identity | Case, whitespace and NFC/NFD variants of one mailbox produced different OTP keys and different accounts | `otp.ts`, `store.ts`, `storeDb.ts` and `adminIdentity.ts` each normalised differently | A single `canonicalEmail()` (NFC + trim + lowercase) is used by all of them. Look-alike characters are deliberately NOT folded | `identityCanonical.spec.ts` (9 tests, including Cyrillic ≠ Latin) | FIXED, VERIFIED |
| ES-04 | P1 | Cashback | Accruals lived only in process memory (lost on restart, one per instance). Claim marked the rows claimed BEFORE crediting, so a failed credit left them claimed but never paid | `services/membership.ts`, claim route | Migration **0026**: a durable `cashback_accruals` table (UNIQUE(user_id, source_ref)). `claim_cashback()` locks the rows `FOR UPDATE`, derives the effect key in SQL, pays through `apply_financial_effect` in the same transaction, and refuses a liability account that is not the claimant's. Dev path: a failed credit un-claims | Harness: 40 barrier-released claims, 100 concurrent and 100 sequential each → 1 payout; A never paid B's accruals; wrong account refused; zero/negative refused. `cashbackClaim.spec.ts` (3). Mutant (no lock + random key) killed | FIXED, VERIFIED (harness). Applying 0026 to staging/prod: BLOCKED_EXTERNAL |
| ES-05 | P1 | Concurrency evidence | The previous "×100 concurrent" evidence came from pooled connections opened lazily, so the calls could run serially. The cashback race mutant SURVIVED it | mutant run | Start barrier `simultaneously(n)`: an advisory-lock gate on its own `pg.Client`; workers wait inside open transactions | **317/317 at `--repeat 100`**: T-W3, T-W1 and T-L2 each ×100 with 0 failures. The 0025 lost-update mutant fails T-L2 in 19 of 20 runs | FIXED, VERIFIED (local PG only) |
| ES-06 | P1 | Edge / rate limiting | Behind CloudFront → ALB, `clientIp()` trusted `x-real-ip` and then the FIRST `X-Forwarded-For` entry. The origin request policy (`Managed-AllViewerExceptHostHeader`) forwards every viewer header, so a client could rotate either one and reset every per-IP limit: OTP send and check, auth, the 150/min API baseline, the deposit-webhook shield, the API-key IP allowlist and Rain's source check | `lib/rateLimit.ts`; `infra/aws/modules/env/edge.tf` origin request policy; four other direct header readers | `FURLPAY_TRUSTED_PROXY_HOPS` (set to `2` in the ECS task: CloudFront appends the viewer, the ALB appends the edge). The viewer is the Nth entry from the RIGHT; `x-real-ip` is ignored; a short chain or a malformed N gives `"unknown"`, never a client value. The ALB `xff_header_processing_mode = "append"` is pinned. The variable is in the env contract, `env.ts` and `.env.example`. All IP readers (transfer, deposit-detect, apiKeyAuth, Rain, compliance) now go through the single function. Vercel behaviour is unchanged when unset | `clientIpTrust.spec.ts` (7), including a source tripwire that no file but `rateLimit.ts` reads an IP header. Mutant (`chain[0]`) fails 3/7. `check-env-contract` OK (23 vars); `terraform validate` dev/staging/prod OK | FIXED, VERIFIED in code. Live CloudFront/ALB header chain: UNVERIFIED (no deployed distribution) |
| ES-07 | P2 | Data exposure | `GET /api/payments/[id]` returned internal ids, the idempotency key, the nonce, review/block reasons and ledger ids | route returned the stored record | `publicPaymentView()` allowlist | `exposureFixes.spec.ts` ES-07 (not mutation-checked) | FIXED, VERIFIED |
| ES-08 | P2 | Data exposure | `GET /api/onramp/session/[id]` echoed the provider `clientSecret` | route | field stripped | `exposureFixes.spec.ts` ES-08, via the route (not mutation-checked) | FIXED, VERIFIED |
| ES-09 | P3 | Auth | Compliance operator bearer compared with `===` (timing) | `complianceOperator.ts` | `timingSafeEqual` over equal-length buffers | `exposureFixes.spec.ts` ES-09 (behavioural only; timing is not measurable in a unit test) | FIXED, VERIFIED |
| ES-10 | P3 | Fabricated data | `/api/ambassadors/instagram` returned a mock profile in production | route | 503 `profile_unavailable` in production | `exposureFixes.spec.ts` ES-10, via the route (not mutation-checked) | FIXED, VERIFIED |
| ES-11 | P4 | SSRF / content | Google Places photo URLs were followed without a host pin | `hotels/googlePlaces.ts` | `isGooglePhotoHost`: https `*.googleusercontent.com` only | `exposureFixes.spec.ts` ES-11, 6 cases including metadata IP and suffix tricks | FIXED, VERIFIED |
| ES-12 | P2 | Financial tripwires | Nothing prevented a regression to random/clock effect keys, `Number()` over base units, ungated in-memory balance writes, silent catches on the money path, or a route taking `userId` from the body | none | `financialTripwires.spec.ts`: 8 rules with reasoned allowlists | 5/5 rules fired on a planted violation file | FIXED, VERIFIED |
| ES-13 | P4 | Docs | `FINANCIAL_EFFECT_INVENTORY.md` listed the investing-order cash leg as un-keyed (it has been keyed `order:{clientOrderId}` since P0-1) and gave the cashback key as sha256 (it is md5, in SQL) | route source | inventory corrected | — | FIXED |
| ES-14 | P3 | Auth | Apple/Google ID tokens are verified (JWKS, iss, aud, exp) but carry no nonce, so a stolen fresh token can be replayed within its lifetime | `auth` routes | — | — | REMAINING |
| ES-15 | P3 | Supply chain | `axios@1.18.1` high advisory, transitive through `packages/contracts` (hardhat-gas-reporter) and `furl-token` (@irys). It is NOT in the web runtime bundle. An override attempt did not re-resolve the lockfile and was reverted | `npm audit --omit=dev` | — | — | REMAINING (lockfile regeneration needs a network install and review) |
| ES-16 | P4 | Precision | `x / 10 ** decimals` for display in `evmAdapter`, `onchain/balances` and `swap` quotes; inexact above 2^53 base units | tripwire allowlist | display/quote only, never a ledger amount | tripwire pins the allowlist | ACCEPTED |
| ES-17 | — | Test environment | `geo/nativeParity.spec.ts` cannot load because `native-app/node_modules` (expo `tsconfig.base`) is not installed in this checkout | vitest transform error | — | — | UNVERIFIED (needs `npm ci` in `native-app`) |
| ES-06b | P1 | Edge / client IP | The ES-06 fix trusted the hop count but returned the placeholder `"unknown"`, did not validate entries, did not bound the header, and left four more readers (newsletter, wallet/authorize, leads, middleware) on the old function | review | One module, `lib/clientIp.ts`: strict IPv4/IPv6 parser (RFC 5952 normalisation, mapped IPv6 → IPv4, brackets and ports as AWS writes them), proxy-written entries must be IPs, 2,048-character bound, `null` instead of a placeholder. Every consumer migrated; rate limits use one strict `untrusted` bucket on null; boot refuses a missing or invalid hop count behind CloudFront | `clientIpTrust.spec.ts` (43 tests; 5/5 mutants killed); tripwire on 10 client-address header names plus `x-forwarded-host/proto/port/prefix` | FIXED, VERIFIED (code). Live chain UNVERIFIED |
| ES-18 | P1 | Edge / TLS | CloudFront's origin was the ALB DNS name, but the viewer `Host` is not forwarded, so CloudFront validates the origin certificate against `*.elb.amazonaws.com`, which no certificate can cover. Every request would 502 | AWS docs (HTTPS to custom origin); `edge.tf` | `origin_domain_name` (`origin-<api>`) with a Route53 alias to the ALB; the CloudFront origin uses it | `terraform validate` (dev/staging/prod) | FIXED (config), UNVERIFIED live |
| ES-19 | P1 | Edge / TLS | A single `acm_certificate_arn` was used for both CloudFront (must be us-east-1) and the ALB (must be the ALB's region, eu-west-1): apply would fail at the listener | `variables.tf`, `edge.tf` | Separate `alb_certificate_arn`; the viewer certificate is validated to be us-east-1 | `terraform validate` | FIXED (config) |
| ES-20 | P1 | Host / origin trust | On ECS the request URL is the bind address (`https://0.0.0.0:3000`, verified on next 15.5.26), so login redirects, OAuth issuer metadata, DPoP `htu`, agent-signature target URIs, checkout return URLs, `wallet/authorize` and the CSRF host check would all be wrong. DPoP and signatures failed closed; redirects and CSRF broke the app | Next standalone reproduction | `lib/publicOrigin.ts` (`PUBLIC_API_ORIGIN`, validated at boot); 12 call sites migrated; CSRF compares against the configured host | `publicOrigin.spec.ts` (13 tests; CSRF mutant killed); tripwire against request-derived origins | FIXED, VERIFIED (code) |
| ES-21 | P3 (latent) | SSRF | `safeFetch` validated the resolved address, then called `fetch(hostname)`, a second DNS resolution, so DNS rebinding to 169.254.170.2 / IMDS was possible. No live route calls it today | source | `pinnedFetch`: socket pinned via `lookup`, while Host, SNI and certificate checks still use the name | `safeFetchPinning.spec.ts` (`.invalid` host reaches the pinned address) | FIXED, VERIFIED |
| ES-22 | P3 (latent) | SSRF | `isBlockedV6` matched spellings: `0:0:0:0:0:0:0:1`, hex-mapped `::ffff:7f00:1`, `fe81::/…` link-local, 6to4 and Teredo all passed; bracketed literals skipped the range check | source; `new URL` re-serialises to hex | Group-based checks using the shared parser | `safeFetchPinning.spec.ts` (11 blocked forms) | FIXED, VERIFIED |
| ES-23 | P2 | Analytics | The admin analytics endpoints read Redis keys nothing writes (`trackAnalyticsEvent` has no callers), so the dashboard could only show zeros. They were absent from the route manifest; the geo endpoint made ~1,440 sequential Redis calls per request, and `from`/`to` were unbounded | source | Rebuilt on durable sources (`users`, `audit_log`, `ops_tx_events`, `ops_security_events`) plus new telemetry; bounded ranges (≤90 days); one cached build per 15 seconds; manifest entries; unavailable sources report a reason instead of zero | `analyticsRoutes.spec.ts` (21), `dashboard.spec.ts` (7), `units.spec.ts` (17) | FIXED, VERIFIED |
| ES-24 | P3 | Alert noise | Every admin GET raised a `high` "admin_action" alert; dashboards polling every 15 s (and the existing `/ops` page, six paths) flooded the channel | `authz.requireRole` | Admin events by category (`lib/adminAudit.ts`): reads audited and throttled, not alerted; mutations audited and alerted; a non-bootstrap admin role is a security event | `semantics.spec.ts` (2 mutants killed) | FIXED |

### Edge trust results

| Check | Result | Evidence |
|---|---|---|
| Single client-IP abstraction | PASS | `lib/clientIp.ts`; tripwire |
| No direct header readers | PASS | Tripwire over 10 address headers and 4 forwarded headers |
| CloudFront policy verified | PASS (docs + TF) | `AllViewerExceptHostHeader` forwards all viewer headers; `CloudFront-Viewer-Address` is NOT relied on |
| ALB append mode | PASS (config) | `xff_header_processing_mode = "append"` |
| Trusted hop count | PASS (docs) | AWS's own example `192.0.2.2,192.0.2.199` |
| Direct ALB spoof prevented | PASS (config), UNVERIFIED live | Prefix-list security group plus secret listener rule plus app check |
| XFF spoof resistance | PASS | Tests and mutants |
| IPv4 / IPv6 / malformed / duplicate headers | PASS | `clientIpTrust.spec.ts` |
| Rate limiting uses trusted IP | PASS | `rateLimitIdentity` |
| Audit/consent use trusted IP | PASS | null stored, never a placeholder |
| Security decisions use auth | PASS | IP is only an additional restriction (API-key allowlist, webhook allowlist after HMAC) |
| Forwarded host trust | PASS | Not read anywhere; URL host is the bind address |
| Forwarded proto trust | PASS | CloudFront strips it, the ALB sets it; no security decision uses it |
| Cache isolation | PASS | Default `CachingDisabled`; `/static/*` matches no route |
| Terraform validation | PASS | fmt + validate, all three envs |
| End-to-end AWS verification | UNVERIFIED | Nothing deployed |

### Audited and found clean (no change)

- **IDOR/BOLA:** every `[id]` route scopes by the session owner; `v1` is tenant-scoped; `p2p/merchant?userId=` returns only a public badge. The tripwire pins this.
- **Session JWT:** HS256 is pinned, with issuer and audience checked. Apple and Google tokens are verified by JWKS; unverified decoding exists only outside production.
- **CORS:** no `Access-Control-Allow-*` headers are emitted.
- **Secrets:** no secret in tracked files; the only hits are test fixtures. Rotation required: none found this pass.
- **Cashback credit:** the claimed "remnant" double-credit bug in `creditCashbackToBalance` does not exist; there is a single effect path.
- **Lot persistence:** `saveLots` rethrows genuine rejections.

## Carried from earlier phases

**REMAINING (code work):**
- nonce-based CSP (P2-1)
- a domain egress firewall (P2-2)
- KV as a system of record (P2-4)
- native items (P2-6)
- deposit follow-ups (P2-8 → P3)
- admin MFA (P2-10)
- iOS App Attest
- an error-tracking SDK
- transaction simulation before signing
- extension content-script scope
- data-key wrapping
- off-ramp and wallet-transfer effect keys, before any rail is connected
- P3-1/2/6, P4-*, P5-*
- the dirty working tree (P1-14, deliberately left uncommitted per the brief)

**BLOCKED_EXTERNAL:**
- Applying 0025 and 0026 to staging and then production; the production schema is unknown (P1-2).
- GitHub Actions billing and branch protection (P1-4).
- The OIDC runtime (P1-5).
- iOS build and Team ID (P1-7).
- Play App Signing fingerprints (P1-8).
- Play Integrity credentials (P1-9).
- AWS org apply (P2-3).
- DR drill (P2-9).
- Chrome Web Store submission.
- PN-1…PN-10: Vercel env, Supabase PITR, partners, Resend DNS, credential rotation, keystore backup, FCM, Guardian audit, DNS lock and npm.

## Verification run (this tree)

| Check | Result |
|---|---|
| `apps/web` `tsc --noEmit` | exit 0 |
| `apps/web` vitest | 5827 passed, 31 skipped, 0 failed tests; 1 suite not loadable (ES-17) |
| `apps/extension` vitest | 167/167 |
| `scripts/db/verify-financial-effects.mjs --repeat 100` | 317/317 |
| `scripts/db/check-migrations.mjs` | OK, 26 migrations |
| `scripts/aws/check-env-contract.mjs` | OK, 23 variables |
| `terraform validate` (dev/staging/prod), `fmt -check` | valid / clean (Terraform 1.11.4, `-lockfile=readonly`) |


### Follow-up (2026-10-01)

Analytics, admin and edge readiness continue in `PRODUCTION_READINESS_FINAL.md` (PR-01 to PR-19, metric definitions, operator procedures, top 10 blockers).
