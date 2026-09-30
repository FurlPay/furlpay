# Production readiness gate

**Date:** 30 September 2026 · **Baseline:** `92e9c57` + the uncommitted changes described in `docs/audit/PRODUCTION_GAP_AUDIT.md`.

Verdicts: **PASS** (evidence cited) · **FAIL** (a defect or missing evidence we could fix ourselves) · **BLOCKED_EXTERNAL** (needs a partner, account, credential, device, audit or users) · **NOT_APPLICABLE**.

A row never gets PASS because UI exists. Two columns are kept apart on purpose: **Code complete** (the implementation is finished and tested) and **Production live** (a real user can do it today, observed).

| Area | Code complete | Production live | Verdict | Evidence / what is missing |
|---|---|---|---|---|
| Android release | Partly | No | **BLOCKED_EXTERNAL** | Signed AAB exists but is from Aug 1 and predates the performance plugin (`docs/performance/PERFORMANCE_BASELINE.md`); Play App Signing fingerprint must be added to `apps/web/public/.well-known/assetlinks.json` or app links break silently; no Play listing |
| iOS release | No | No | **BLOCKED_EXTERNAL** | No Apple Developer account; see `docs/release/IOS_RELEASE_READINESS.md` |
| Authentication | Yes | Yes (web) | **PASS** | Passkeys live on web (`lib/productionStatus.ts` `passkeys`); session epochs; `optionalUser` rejects bad credentials |
| Wallet security | Yes | App not distributed | **PASS** (code) | Self-custodial key in SecureStore behind biometrics; recovery phrase never transmitted; `native-app/lib/__tests__/wallet.test.ts` known-answer vectors vs viem |
| Transaction security | Mostly | App not distributed | **FAIL** | Two-layer scan + WalletConnect policy are in place, but **server-side App Attest / Play Integrity verification is not implemented** (`apps/web/src/lib/integrity/providers.ts`) |
| Agent payments | Yes | No | **BLOCKED_EXTERNAL** | Blocked on x402 settlement: no production facilitator signer / RPC (`productionStatus.ts` `agent-payments`) |
| Swaps | Yes | Not observed | **FAIL** (evidence) | LI.FI quote + non-custodial execution exist (`native-app/lib/swap/executeSwap.ts`); the server `api/swaps` execute path 503s in production by design. No observed production swap recorded |
| Gasless transfers | Yes | No | **BLOCKED_EXTERNAL** | Relayer fee payer not configured/funded (`productionStatus.ts` `gasless`) |
| Cards | Seam only | No | **BLOCKED_EXTERNAL** | No issuer; every card route 503s in production (PGA-008 closed the last bypass); `docs/integrations/CARD_ISSUER_INTEGRATION.md` |
| Banking | Ports only | No | **BLOCKED_EXTERNAL** | No regulated partner; `docs/integrations/FIAT_PROVIDER_INTEGRATION.md` |
| P2P | Partly | No | **FAIL** + **BLOCKED_EXTERNAL** | In-process escrow invariants now tested (`p2pEscrowInvariants.spec.ts`), but state is process memory with no cross-instance lock (PGA-R01) and appeals cannot be resolved (PGA-R02). Also needs legal review |
| Investing (one-off orders) | Yes | No | **BLOCKED_EXTERNAL** | Order route is honest (503 in production); needs a live brokerage agreement (`BROKERAGE_LIVE`) |
| Recurring investments | No | No | **FAIL** + **BLOCKED_EXTERNAL** | No durable schedule store, no executor (PGA-009); creation 503s in production; needs brokerage too |
| Credit | No | No | **BLOCKED_EXTERNAL** | `CREDIT_LIVE` `unimplemented` (PGA-004) |
| Rewards / referrals | No | No | **FAIL** | No rewards ledger (PGA-005); gated off |
| Localization | Yes | App not distributed | **PASS** (gate) / **FAIL** (content) | Key parity compiler-enforced; ratchet test added; es/fr/pt missing CLDR `many` forms, identical-to-English strings listed per key in `docs/i18n/LOCALIZATION_REPORT.md` for a translator |
| Accessibility | Partly | Not verified | **FAIL** (evidence) | 198 `accessibilityLabel` uses across 82 files, but no screen-reader (TalkBack / VoiceOver) pass has been recorded |
| Performance | Partly | Not measured | **BLOCKED_EXTERNAL** | Bundle 9.46 MB measured; cold start / frames need a device (`PERFORMANCE_BASELINE.md`) |
| Observability | Yes | Partly | **PASS** (redaction) | Web `lib/redact.ts`, mobile `lib/observability/scrub.ts`, ops security events, `api/ops/readiness`. Crash-free-session tracking and symbolicated iOS crashes unverified without a release build |
| Security review | Internal only | — | **BLOCKED_EXTERNAL** | No independent audit; `docs/security/SECURITY_HARDENING_2026.md` prepared for one |
| Secrets | Yes | — | **PASS** | Tracked-file sweep clean; no `.env*` tracked; vendor keys proxied server-side |
| CI/CD | Yes | — | **PASS** | Web suite 310 files / 5,697 tests green; native suite green after PGA-017; deploy gate requires CI success for the exact SHA |
| Store readiness | No | No | **BLOCKED_EXTERNAL** | No Play listing, no App Store Connect record, privacy labels not authored |

## Overall

**Not releasable to the public as a money app.** Code-side, the blocking items we own are: server-side attestation verification, durable P2P / schedule storage, an accessibility pass, and a fresh Android release build with the performance plugin. Everything else on the critical path is external: a card issuer, a banking partner, a brokerage agreement, an Apple Developer account, an independent security audit, and real users.

What *can* ship honestly today is what `lib/productionStatus.ts` already marks `live` (web platform, passkeys, developer APIs, x402 challenge, non-custodial payment APIs, market data, hotel map) — plus a self-custody wallet build, once the Android release is rebuilt and listed.
