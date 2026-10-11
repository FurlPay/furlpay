# FurlPay full codebase audit — 2026-10-05

Scope: `native-app/` (React Native, Android + iOS), `ios/FurlPayGuardian/` (Swift iPhone + watchOS),
`apps/extension/` (Chrome MV3), `guardian/` (Android + Wear OS), plus the `apps/web` backend those
clients depend on, the Node SDK, and the on-chain packages.

Every finding below was checked against code, a build/test run, CI, DNS, or the live system. Branch
`fix/cron-store-unavailable` @ `cd74ebe`, with 64 files of uncommitted work from another session.

## Build and test status (run today)

| Component | Typecheck | Tests | CI |
|---|---|---|---|
| native-app | `tsc` clean | 118 suites / 1,874 tests pass | — |
| ios/FurlPayGuardian | **does not compile** | not runnable | iOS Guardian: **100 of the last 100 runs failed** |
| apps/extension | `tsc` clean | 16 files / 228 tests pass | — |
| guardian (Android/Wear) | — | 156 JVM unit tests pass (JDK 17) | — |
| apps/web (with the uncommitted work) | `tsc` clean | 6,621 pass / **7 fail** / 31 skipped | CI on `extension-redesign`: latest run failed |
| sdks/node (with the uncommitted work) | **8+ errors** | — | — |

---

## P0 — production is broken, or every user is affected

### P0-1  Production web API is down: every serverless function refuses to start
- **Evidence:** Vercel runtime logs for furlpay.com, repeated on every dynamic request:
  `[boot] refusing to start: FURLPAY_ADMIN_EMAIL must be set in production.` (`src/instrumentation.ts:24`).
  Live probes: `/api/auth/session` 500, `/api/markets` 500, `/api/health` 500,
  `/.well-known/apple-app-site-association` 500. Static pages (`/`, `/login`) still return 200.
- **Cause:** production deployment `web-o3mdi82u1` (5h old) went out without `FURLPAY_ADMIN_EMAIL`.
  `vercel env ls production` does not list the variable.
- **Impact:** nobody can sign in or load data on web, mobile, iOS, the extension or the watch. The AASA 500
  also breaks iOS Universal Links and passkey `webcredentials` for furlpay.com.
- **Fix:** add `FURLPAY_ADMIN_EMAIL` to the production env and redeploy, or roll back to the previous good
  deployment. The uncommitted change that would disable admin instead of crashing (`adminConfigStatus`)
  is only half done; its tests fail (P1-4).

### P0-2  Every native client is built against API hostnames that don't exist
- **Evidence:** `nslookup` returns NXDOMAIN for `api.furlpay.com`, `api-staging.furlpay.com` and `api-dev.furlpay.com`.
- **Where they are hardcoded:**
  - `native-app/app.config.js` `API_BASE_BY_ENV`. This file overrides `EXPO_PUBLIC_API_BASE` for every
    build, and a release build *refuses* any other value. The `furlpay.com/api` fallback in `lib/api.ts` is never reached.
  - `ios/FurlPayGuardian/Config/{Dev,Staging,Prod}.xcconfig` `FURLPAY_API_HOST`
  - `guardian/app/mobile/build.gradle.kts` and `guardian/app/wear/build.gradle.kts` `API_BASE_URL`
  - `apps/extension/wxt.config.ts` host_permissions / `lib/api.ts` ALLOWED_ORIGINS (harmless: the extension defaults to furlpay.com)
- **Impact:** an Android, iOS, Guardian or Wear build made from current source cannot reach any backend.
  The AWS environments these names belong to were never provisioned.
- **Fix:** point `prod` at `https://furlpay.com/api` until the AWS stack exists, or create the DNS records. Keep the
  release-build guard, but pointed at a host that resolves.

### P0-3  Mobile tamper detection (freeRASP) ships with placeholder config and `isProd: true`
- **Where:** `native-app/lib/security/tamperDetection.ts`; started from `app/_layout.tsx:135`. The wiring was inserted by the stray `native-app/patch.js`.
- **Config:** `packageName: 'com.furlpay.mobile'` (the app is `com.furlpay.app`), `certificateHashes: ['TODO_CERT_HASH']`,
  `appTeamId: 'YOUR_TEAM_ID'`.
- **Impact:** any threat callback sets `compromised = true`. `riskEngine.ts:128` then returns **BLOCK for every
  money-moving action** ("This device appears to be rooted or modified"). With a wrong package and signing hash,
  `appIntegrity` is expected to fire on every genuine install, which blocks all payments for all users. If
  `talsecStart` instead throws on the bad hash, the error is swallowed with a `console.warn` and there is no
  protection at all. Neither outcome is acceptable. Not yet confirmed on a device; it needs one run on a signed
  release build.
- **Fix:** use the real package/bundle id, the Play App Signing SHA-256 (base64) and the Apple Team ID, set `isProd` from the build env,
  and make a start failure visible as `integrityUnknown`, not silent.

---

## P1 — security exposure, or a release blocker

### P1-1  iOS Swift app (`ios/FurlPayGuardian`) has never compiled
- **Evidence:** `gh run list --workflow ios-guardian.yml -L 100`: 100 failures, 0 successes. Latest run 37238795442 errors:
  `cannot find 'SecTaskCreateFromSelf' in scope`, `cannot find 'SecTaskCopyValueForEntitlement' in scope`,
  `'ComputeGuardianScore' cannot be constructed because it has no accessible initializers`, `'nil' requires a contextual type`.
- `SecTask*` is not public API on iOS. Even once the code compiles, calling it risks App Store rejection. Read
  entitlements another way, or drop the check.
- The README already says "treat every file as a reviewed first draft". The app is not shippable.

### P1-2  Native Apple sign-in: a one-time handoff code over a custom scheme, with no PKCE
- **Where:** `apps/web/src/app/api/auth/apple/callback/route.ts` redirects to `furlpay://auth?code=…&state=…`;
  `native-app/lib/oauth.ts` redeems the code at `/api/auth/native/exchange`, which needs only the code.
- **Impact:** custom schemes are not exclusive on Android. Another installed app that registers `furlpay://` can
  receive the redirect and redeem the code for a full session, i.e. account takeover. `state` only protects the
  legitimate app against CSRF. The `nonce` the app generates is never checked by the server (`verifyAppleIdentityToken` gets no nonce).
- **Fix:** bind the code to a PKCE `code_verifier` sent at exchange, redirect through an App Link (`https://furlpay.com/l/auth`),
  and check the nonce.

### P1-3  FURL token: mint authority still live on a single hot key
- **Evidence (mainnet RPC, today):** mint `FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1` has
  `mintAuthority = FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL`, freeze authority null, supply 1,000,000,000.
  All supply sits in the deployer's ATA, and that keypair lives on this laptop.
- **Impact:** anyone holding that key can mint without limit, so the "fixed supply" claim is false until authority is revoked or moved to a multisig.

### P1-4  The uncommitted work (64 files, another session) breaks builds if committed as-is
- `sdks/node/src/webhooks.ts` is deleted, but `src/index.ts` still imports it, and seven type exports
  (`Balance`, `Card`, `Order`, `Stablecoin`, `SwapQuote`, `Wallet`, `Chain`) were removed from `types.ts`, so `tsc` fails.
  This also deletes the SDK's only webhook signature verifier (`constructEvent`).
- 7 web tests fail:
  - `adminFallback.spec` ×2 and `bootConfig.spec`: `adminConfigStatus` is half-wired
  - `payouts/batch` ×2: the error code changed to `Validation failed`, and a mock is missing `getPaymentsByIdempotencyPrefix`
  - `arcDecimals.spec`: `EURC.arc` was registered as a second asset
  - `stablecoins.spec`: PYUSD address stored lowercase, not EIP-55
- `apps/developer/keys` route + page rewrite (−1,301 lines) drops agent-key listing, security findings, and IP/origin allowlists.
  Decide whether that is intended before committing.

### P1-5  Committed payment intents live in a per-process Map
- `apps/web/src/lib/services/payments.ts` `createPayment` stores intents and idempotency keys in in-memory Maps.
  On serverless that state disappears between instances, while signing data has already gone to the client.
  The uncommitted change adds a production refusal (`IntegrationNotConfiguredError`). Commit that guard, or connect the durable repository.

---

## P2 — real defects, or misleading behaviour

### P2-1  Extension x402 "pay" goes nowhere, and its safety comment is false
- `apps/extension/entrypoints/background.ts` `openX402Checkout` opens `${base}/developer?x402=…`. `apps/web/src/app/developer/page.tsx`
  never reads the parameter. The code comment (and `x402-overlay.content.ts`) says "furlpay.com re-fetches the 402 and verifies
  recipient/amount". That code does not exist. Either build the verifying checkout or remove the "Pay with FurlPay" button.

### P2-2  Extension fee scanner makes a misleading consumer claim on every checkout page
- `entrypoints/fee-scanner.content.ts` and `lib/fees.ts` inject "Cards cost ~$X more here. FurlPay: 0.5%" on any page matching
  `checkout|payment|cart|billing|order|book`. Card processing fees are paid by the merchant, not the shopper, and FurlPay
  cannot pay on those sites. This risks a Chrome Web Store "deceptive behaviour" rejection. Reword it or remove it.

### P2-3  WalletConnect typed data: domain `chainId` is not bound to the session chain
- `native-app/lib/walletconnect/requests.ts` `decodeTypedData` and `lib/evm/eip712.ts` `validateTypedData` never compare `domain.chainId`
  with the request's chain. The request sheet shows the *session* network (`RequestSheet.tsx:133`), so a dApp on a Polygon session
  can get a mainnet (chain 1) Permit signed while the sheet says "Polygon". Reject a mismatch, or show the domain chain.

### P2-4  The watch receives the phone's full-power session token
- iOS: `WatchSyncCoordinator.pushToken` sends the token with `sendMessage` / `transferUserInfo`, and the watch saves it
  (`WatchApp.swift:50`).
- Wear OS: `SyncCoordinator.pushToken` writes it to a **persistent DataItem** `/guardian/auth-token`, which the Data Layer
  syncs to every paired node.
- The paired-node gate is good, but the credential is the same bearer that moves money on the phone. Mint a
  scoped, short-lived, read-only watch token, and use `MessageClient` rather than a DataItem.

### P2-5  Mobile banking Send / Convert / Direct are client-side previews in the production app
- `native-app/app/banking.tsx`: the buttons only call `setDone(true)`. They are marked `PreviewBanner` / "Previewed …", but Direct shows
  "Fee $0.00 · Arrives in minutes" for PayPal, Revolut, Wise and others, none of which are integrated. The server honestly returns 503 for
  provisioning. Hide these flows in prod builds.

### P2-6  On-chain code is not deployable or audited
- `furlpay-programs/programs/furlpay-escrow/src/lib.rs:9` `declare_id!("FurlPay1111…")`: `l` is not base58, so the program cannot compile.
- `packages/contracts/*.sol` (Escrow, Router, X402Facilitator, ComplianceEscrow, CanonicalFURL): unaudited, not reviewed in depth here.

### P2-7  CI gives no signal
- iOS Guardian is always red (P1-1). The `CI` workflow on `extension-redesign` failed on its latest run (37239262912) and was cancelled on the one before.
  Builds are being judged without a green pipeline.

---

## P3 — hardening and hygiene

- **P3-1** Wallet provisioning modules are dead code. `modules/google-pay-provisioning` has no `build.gradle`, and
  `modules/apple-wallet-provisioning` has no podspec, so neither autolinks. TapAndPay (`play-services-tapandpay`) is not on public Maven,
  and the `withGooglePayTapAndPay` plugin is not registered in `app.json`. The app falls back cleanly (`requireOptionalNativeModule`); delete the modules or finish them.
- **P3-2** The Telegram webhook compares its secret token with `!==` (`api/telegram/webhook/route.ts:14`); use `timingSafeEqual`.
- **P3-3** `WearBridge.isGuardianInstalled` trusts the package name only, not the signing certificate.
- **P3-4** The mobile SQLite cache (balances, tx history, outbox) is unencrypted at rest. This is documented in `lib/db.ts`; `allowBackup=false` limits exposure.
- **P3-5** Gasless send: when the server answers `simulated`, the user has still handed over a valid 10-minute EIP-3009 authorization. Fetch the quote's `live` flag
  first and refuse to sign when it is false.
- **P3-6** Any page can trigger `OPEN_X402_CHECKOUT` to open furlpay.com tabs, with no per-tab rate limit.
- **P3-7** Stray files: `native-app/patch.js`, `apps/web/script.js`, `apps/web/findings.json` (90 regex hits; I hand-checked all 12 CRITICAL entries and all are
  false positives: every webhook verifies, and `totpSecret` is stripped before responses), and untracked research `.md` files at the repo root.
- **P3-8** The deprecated TWA `apps/android` still claims `com.furlpay.app`. Delete it, so it can never be uploaded over the RN app.
- **P3-9** `native-app/furlpay-mobile-release.{aab,apk}` (Aug 1, 64 MB / 109 MB; gitignored) are stale against current source. Don't distribute them.

---

## Pn — checked and sound (no action)

- **native-app:** mnemonic stored `requireAuthentication` + `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; session token `ThisDeviceOnly`; keys zeroed after signing;
  EIP-3009 signing pinned to known USDC contracts with a sender match; `eth_sign`, `wallet_addEthereumChain` and `wallet_watchAsset` refused; app lock refuses
  devices with no screen lock; transaction-bound passkey proof for sends; cert pinning (ISRG + Amazon) with a pin-set expiry; cleartext off in release;
  release builds refuse a non-prod API base.
- **Extension:** content-script message boundary enforced at runtime (`messageGate.ts`); connect requires per-origin consent; page-supplied `payTo`/amount never forwarded;
  production manifest drops the dev `key` and localhost permissions.
- **Wear OS / Guardian:** auth token accepted only from a connected node (`PairedNodeGate`); every watch action's endpoint is pinned in `GuardianActionRegistry`;
  unfreeze is phone-only behind biometrics; QuickPay is receive-only.
- **iOS Swift (design, not build):** keychain `WhenUnlockedThisDeviceOnly`; SPKI pinning to ISRG/Amazon roots.
- **Web:** every inbound webhook verifies a signature; guest login is closed on production deployments; mock OTP codes are blocked in production
  (`assertLiveInProduction`); banking provisioning honestly returns 503.

## Not covered

Solidity contracts in depth, `apps/desktop`, the commerce plugins (Shopify/Woo/Magento), the other SDKs (`furlpay-python-sdk`, `-kotlin`, `-swift`, `-react-native`),
the `packages/*` agent integrations, and the standalone `furlpay-mobile-app` / `furlpay-wearable-app` Expo apps.

## Recommended order

1. P0-1: restore production (env var + redeploy, or rollback).
2. P0-2 and P0-3: fix the API host and the freeRASP config before cutting any mobile build.
3. P1-2: PKCE-bind the Apple handoff. P1-3: revoke or multisig the FURL mint authority (irreversible, so get explicit sign-off).
4. P1-4: finish or split the uncommitted work before anything is committed from this tree.
5. Get the iOS Guardian build green, or drop it from the release plan.
