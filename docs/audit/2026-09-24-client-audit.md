# FurlPay client audit — Android, iOS, Wear OS, Chrome extension

**Date:** 2026-09-24
**Scope:** `apps/extension`, `native-app` (RN, Android + iOS), `guardian` (Kotlin phone + Wear OS), `ios/FurlPayGuardian` (Swift iPhone + Apple Watch), `apps/android` (TWA)
**Method:** source review of ~113k lines across the five client codebases. No dynamic testing, no instrumented device, no built artifact was run.

---

## Verdict

These are unusually well-built clients. The security reasoning is written down in the code, the trust boundaries are drawn deliberately, and several of the hardest things — the x402 detection trust model, the Wear/phone pairing invariant, the deep-link allowlist, iOS keychain accessibility — are handled better than most production fintech codebases.

The defects that do exist cluster into **one shape**, and it is worth naming because it explains almost every High finding below:

> A security property is implemented correctly **on one surface** and then not carried across to the other three. Sign-out, 401 handling, keychain hardening, certificate pinning and environment configuration are each right somewhere and missing somewhere else.

There is no shared specification for "what a session ending means", so each of the four clients invented its own and they disagree. That is the root cause of findings 1, 2, 3, 5 and 12.

**Counts:** 3 High · 9 Medium · 5 Low · 1 Critical-by-architecture

---

## High

### 1. iOS — the Apple Watch session token can never be revoked

**Where:** `ios/FurlPayGuardian/FurlPayGuardian/App/ServiceContainer.swift:260`, `Services/Sync/WatchSyncCoordinator.swift:45`, `FurlPayGuardianWatch/Services/WatchConnectivityService.swift:97`

`signIn` pushes the session JWT to the watch:

```swift
public func signIn(token: String) async throws {
    try await tokenStore.save(token)
    …
    await sync.pushToken(token)      // ← goes to the watch
}
```

`signOut` does not have the mirror-image call. It clears the phone's keychain, the repositories and the assistant transcript — and never touches the watch.

Three things have to be true at once for this to be un-fixable at runtime, and all three are:

1. `WatchSyncCoordinator` exposes only `pushToken(_ token: String)`. There is no clear/revoke API.
2. Even if it pushed an empty string — the technique the Android app uses — the watch would discard it: `if let token = payload[SyncKey.token] as? String, !token.isEmpty`.
3. The watch talks to the API **directly** as a fallback ("the watch talks to the same API directly when the phone is unreachable"), so the token is not merely cached display state. It authenticates real requests.

**Impact:** signing out on the iPhone leaves a valid bearer token on the paired Apple Watch until the JWT's own expiry. Selling or returning the phone does not revoke it.

**Fix:** add `clearToken()` to `WatchSyncCoordinator` (a distinct `SyncKey.signOut` flag, not an empty token), call it from `signOut()`, and have the watch clear its store on receipt. Server-side session revocation on sign-out would make this defence-in-depth rather than the only control.

---

### 2. Android/Wear — two of three sign-out paths leave a live token on the watch

**Where:** `guardian/core/security/.../AuthManager.kt:40`, `app/mobile/.../viewmodel/DashboardViewModel.kt:68`, `app/mobile/.../viewmodel/DeleteAccountViewModel.kt:176`

The watch-clearing logic lives in a **ViewModel**, not in `AuthManager`:

```kotlin
// DashboardViewModel — the ONLY path that clears the watch
fun signOut() {
    services.authManager.signOut()
    runCatching { services.dataLayer.putJson(SyncProtocol.DATA_AUTH_TOKEN, "") }
}
```

Every other caller of `AuthManager.signOut()` misses it:

| path | clears watch? |
|---|---|
| Dashboard "Sign out" button | yes |
| `AuthManager.onUnauthorized()` — any 401 anywhere | **no** |
| `DeleteAccountViewModel.delete()` — account deletion | **no** |

The account-deletion case is the worst: the server account is gone, but the watch keeps a token and a full local snapshot of balances, spending and trips.

**Fix:** move the Data Layer clear into `AuthManager.signOut()` so it is on the single path every caller uses. `AuthManager` would need the `DataLayerManager` injected, which is why it presumably ended up in the ViewModel — that is a dependency-wiring inconvenience, not a reason to have three sign-out semantics.

---

### 3. React Native — the session JWT is the least-protected secret in the app

**Where:** `native-app/lib/api.ts:44`

The wallet mnemonic is stored correctly:

```ts
// lib/wallet.ts
const SECURE_OPTS = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
```

The session token — which can move money through the API without ever touching the mnemonic — is stored with **no options at all**:

```ts
await SecureStore.setItemAsync(TOKEN_KEY, token);
```

That takes the platform default. On iOS this permits the item into an encrypted iCloud Keychain backup, so the token can reappear on a restored device the user no longer holds — exactly the property the `ThisDeviceOnly` flag was chosen to prevent for the mnemonic.

Same omission on: `lib/security/antiPhishing.ts:21` (anti-phishing phrase — an attacker who can read it can forge the trust signal), `lib/security/deviceIntegrity.ts:166` (`app_attest_key_id`), `lib/watch.ts:74`, `lib/flags/index.ts:143`, and `lib/wallet.ts:196-198` (addresses + readiness marker).

**Fix:** at minimum `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` on the token. Not `requireAuthentication: true` — that would prompt for biometrics on every background refresh, which is the tradeoff the iOS Guardian app documents and resolves the same way.

---

## Critical (architecture)

### 4. No client had any environment concept — all four hardcoded production

| client | before |
|---|---|
| Guardian Android + Wear | `const DEFAULT_BASE_URL = "https://furlpay.com/api/"` (Kotlin `const`, unreachable from a build) |
| iOS Guardian + Watch | `baseURL: URL = URL(string: "https://furlpay.com/api/")!` (default parameter) |
| React Native | `EXPO_PUBLIC_API_BASE ?? "https://furlpay.com/api"`, and **`eas.json` declared no `env` block on any profile** |
| Chrome extension | `import.meta.env.DEV ? localhost : furlpay.com` — two states, no staging |

A `development` EAS build, a `preview` build handed to a tester, a debug Gradle install and an Xcode Debug run all talked to the **production backend**. Every QA tap moved real money.

**This has been fixed** — see "Changes made" below.

---

## Medium

### 5. Wear OS — no `sourceNodeId` verification anywhere

`sourceNodeId` does not appear once in the guardian codebase. `WearListenerService.onDataChanged` accepts `DATA_AUTH_TOKEN` from any node in the Wear network and writes it straight into the Keystore-backed token store:

```kotlin
SyncProtocol.DATA_AUTH_TOKEN -> {
    services.tokenStore.update(json.takeIf { it.isNotBlank() })
}
```

There is no allowlist of the paired phone node. The Data Layer is app-namespaced and GMS-mediated, which bounds this considerably — but the auth-token path is the one place where "which node sent this" should be checked explicitly rather than assumed.

**Fix:** capture the phone's node id at pairing, store it, and reject `DATA_AUTH_TOKEN` events from any other source node.

### 6. Wear/mobile — exported services with no permission guard

`guardian/app/wear/.../AndroidManifest.xml:36` (`WearListenerService`) and `app/mobile/.../AndroidManifest.xml:66` (`VoiceRelayService`) are `android:exported="true"` with no `android:permission`. Every tile and complication service **in the same file** correctly carries a `BIND_TILE_PROVIDER` / `BIND_COMPLICATION_PROVIDER` guard, so this is an internal inconsistency rather than a deliberate choice. `onMessageReceived` reachable this way can start `WatchAlarmService` via `MSG_ALARM`.

### 7. Certificate pinning exists on exactly one of four native surfaces

`native-app/plugins/withNetworkSecurityConfig.js` is genuinely excellent — root pins (not leaf), a dead-man's-switch expiry, and a build that **fails loudly** before the pins lapse. It applies to **Android only**.

No pinning in: RN iOS, Guardian Android/Wear (no OkHttp `CertificatePinner`), iOS Guardian (no `URLSessionDelegate` server-trust evaluation).

> **This is also an AWS migration blocker — see finding 16.**

### 8. RN — every iOS request identifies itself as Android

`native-app/lib/api.ts:37`:

```ts
const CLIENT_HEADER = `mobile-android/${CLIENT_VERSION}`;
```

The comment directly above this line explains at length that the *version* used to be hardcoded and silently drifted, and that "server-side telemetry, minimum-version checks and per-client rollouts read this string". The *platform* half is still hardcoded, in an app that ships on both. Every one of those three consumers is answering questions about the wrong platform.

**Fix:** `mobile-${Platform.OS}/${CLIENT_VERSION}`. Note the server contract requires the `mobile` prefix (`apps/web/src/lib/clientKind.ts`), which this preserves.

### 9. Extension — `postMessage` with a wildcard target origin

`apps/extension/entrypoints/x402-main.content.ts:35` posts detections with `"*"`:

```ts
window.postMessage({ source: MARK, detection: {…} }, "*");
```

Both sibling content scripts deliberately use `window.location.origin` and say why ("a wildcard would hand it to any cross-origin frame on the page"). This one does not, so any third-party iframe — an ad frame, an embedded widget — can observe which resources the user hits a 402 on, plus the advertised payment requirements.

### 10. Extension — `setBaseUrl` accepts any string

`apps/extension/lib/api.ts:23` persists whatever it is given; `SettingsTab.tsx:261` is a free-text input with no validation. Host permissions limit where fetches can actually land, so this is hardening rather than a live exploit — but there is no scheme check, no host allowlist, and the failure mode is silent breakage.

### 11. `android:allowBackup` defaults to true in three manifests

Unset in `guardian/app/mobile`, `guardian/app/wear`, and set explicitly `true` in `apps/android` (TWA). None declare `dataExtractionRules`. The RN app gets this right (`app.json`: `"allowBackup": false`).

### 12. Wear — a 401 on the watch did nothing at all

`WearServices` constructed `FurlPayClient(tokenStore = tokenStore)` with **no `onUnauthorized`**. The phone app has wired it since it was written. On the watch, an expired session left the token in the Keystore, every call kept failing, and the tiles rendered stale data indefinitely with no way for the user to tell. **Fixed** — see below.

### 13. iOS — 401 handling is incomplete relative to the other two clients

`FurlPayAPIClient.swift:265` clears the keychain and nothing else:

```swift
if http.statusCode == 401 { await tokenStore.clear() }
```

It does not set `isSignedIn = false`, clear the repositories, reset the assistant transcript — which the code elsewhere correctly notes "holds balances and card digits" — or clear the watch. The UI stays "signed in" showing the previous session's data. Compare React Native (`setUnauthorizedHandler` → push dereg + cache wipe + WalletConnect shutdown + state flip) and Android (`AuthManager.onUnauthorized` → state flip).

**Fix:** route the 401 through `ServiceContainer.signOut()`, the same way the other two clients route theirs through one teardown.

---

## Low

### 14. RN — the OTP is rendered from a server-controlled field with no client-side guard

`app/(auth)/login.tsx:339` renders `devCode` whenever the server returns it. Gating is entirely server-side. A regression that leaked `devCode` from production would put the OTP on screen. Wrap in `__DEV__`.

### 15. UI/UX — "Fingerprint" is named on devices that have no fingerprint reader

`login.tsx:195` — the primary sign-in CTA is `"Sign in with Fingerprint"`, and `lib/passkey.ts:105,111` produce `"Fingerprint prompt was cancelled."` / `"Fingerprint sign-in failed."`. On an iPhone with Face ID this names hardware the device does not have. `components/signing/SignerPicker.tsx:24` already gets it right: `"Face ID or fingerprint"`.

### 16. Extension — XHR listener accumulation

`x402-main.content.ts:57` adds a `load` listener on **every** `open()` call on the patched prototype. A page that reuses one `XMLHttpRequest` object accumulates listeners and emits duplicate detections.

### 17. iOS — `save()` has a delete-then-add window

`KeychainTokenStore.save()` does `SecItemDelete` then `SecItemAdd` (correctly — `SecItemUpdate` cannot change accessibility attributes). If the add fails, the old token is already gone. It throws, so a caller can react; no caller currently does.

### 18. TWA is a live footgun

`apps/android` shares `com.furlpay.app` with the canonical RN app. `eas.json` documents that it "must never be submitted". It is still buildable and still signed.

---

## AWS migration blocker (found while designing the infrastructure)

### 19. The Android certificate pins will reject every AWS endpoint

This one is not visible from either side alone.

`withNetworkSecurityConfig.js` pins `furlpay.com` with `includeSubdomains="true"`, to three **ISRG / Let's Encrypt** roots. The new environment hostnames — `api.furlpay.com`, `api-staging.furlpay.com`, `api-dev.furlpay.com` — are subdomains, so **the pin set applies to them**.

AWS Certificate Manager issues certificates that chain to **Amazon Root CA 1**, not ISRG. The first Android build pointed at an AWS endpoint will fail every TLS handshake, and the app will look like it has no network connectivity.

**Before any client is repointed**, one of:

- add the Amazon Root CA 1 / CA 2 / CA 3 SPKI pins to the `<pin-set>` alongside the ISRG ones (keeps pinning through a phased cutover — recommended), **or**
- narrow the `<domain-config>` so the pin set covers only the hostnames still served by Vercel.

The plugin's `assertPinsNotNearExpiry` build gate will not catch this: the pins are valid, they simply do not match the new chain.

---

## Remediation status

**All 19 findings are fixed.** See `docs/audit/2026-09-25-remediation.md` for the
per-finding change list, the verification evidence, and what remains unverified.

The original "what was changed" list below covers only the first pass
(environment separation).

---

## What was changed in the first pass

| file | change |
|---|---|
| `infra/aws/**` | New. Terraform for three isolated environments. |
| `native-app/app.config.js` | Resolves `FURLPAY_ENV` → API base, bundle-id suffix, display name. Refuses a release build pointed off production. |
| `native-app/eas.json` | `env` block on every profile; `staging` alias added. |
| `guardian/app/{mobile,wear}/build.gradle.kts` | `dev`/`staging`/`prod` product flavors with matched `applicationIdSuffix` and a `BuildConfig.API_BASE_URL`. |
| `guardian/app/mobile/.../GuardianApp.kt` | Client reads `BuildConfig.API_BASE_URL`. |
| `guardian/app/wear/.../GuardianWearApp.kt` | Same, **plus wires the missing `onUnauthorized`** (finding 12). |
| `ios/FurlPayGuardian/Config/*.xcconfig` | New. Per-environment API host, bundle suffix, APNs environment. |
| `ios/FurlPayGuardian/project.yml` | Debug/Staging/Release configurations; suffixed bundle ids incl. `WKCompanionAppBundleIdentifier`. |
| `ios/FurlPayGuardian/Shared/Network/AppEnvironment.swift` | New. Reads the build configuration; fails loudly rather than defaulting to prod. |
| `.github/workflows/mobile-release.yml` | New. Per-platform, per-environment lanes gated on GitHub Environments. |
| `docs/aws/RUNBOOK.md` | New. |

### The pairing invariant, preserved

Both Gradle files carried a warning that the phone and watch apps must keep an **identical `applicationId`** or the Wearable Data Layer silently stops pairing. Environment suffixes were therefore put on the **flavor**, duplicated exactly across both modules, and the CI job asserts it with `aapt2 dump packagename` on both APKs — because the field symptom (a watch showing no data, logging nothing) is one of the most expensive bugs in this product to diagnose from a user report.

The iOS equivalent is `WKCompanionAppBundleIdentifier`, which now carries the same suffix. Without that, a staging watch app would pair with the tester's **production** phone app and be fed production tokens while its own API host said staging.

### Not verified

- **Terraform is not installed on this machine.** The configuration has not been through `validate`, `plan` or `apply`. Treat the first plan as real work.
- No AWS credentials were used and no resources were created. Nothing costs money yet.
- The Gradle, Xcode and EAS changes were not built — Android/iOS toolchains are not present here.

---

## Suggested order

1. **Finding 19** before repointing any Android client, or the cutover fails at the TLS layer.
2. **Findings 1, 2** — a session that cannot be ended is the most serious class here.
3. **Finding 13**, then **3** — both are one-file changes.
4. Write down the session-lifecycle contract the four clients are supposed to share, then **5, 6, 12** fall out of it.
5. The rest as ordinary backlog.
