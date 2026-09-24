# Client audit — remediation

**Date:** 2026-09-25
**Covers:** every finding in [`2026-09-24-client-audit.md`](./2026-09-24-client-audit.md)
**Status:** all 19 fixed.

---

## The blocker first

### 19 · Android certificate pins reject every AWS endpoint — FIXED

The pin set matches `furlpay.com` with `includeSubdomains="true"`, so it already
covered `api.furlpay.com` and the other new hosts. ACM certificates chain to
Amazon Trust Services, not ISRG, so the first AWS-pointed build would have failed
every handshake and presented as "no connectivity".

**Every pin value in this repo was recomputed from the published root
certificate**, not transcribed from documentation or from memory:

```
openssl x509 -in <root>.pem -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | openssl enc -base64
```

| Root | SPKI SHA-256 (base64) |
|---|---|
| ISRG Root YR (RSA, gen-Y) | `fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=` |
| ISRG Root YE (EC, gen-Y) | `sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=` |
| ISRG Root X1 | `C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=` |
| ISRG Root X2 | `diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=` |
| Amazon Root CA 1 | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` |
| Amazon Root CA 2 | `f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=` |
| Amazon Root CA 3 | `NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=` |
| Amazon Root CA 4 | `9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=` |
| Starfield Services Root CA G2 | `KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=` |

Two independent confirmations: the five Amazon SPKI **hex** digests computed
locally match the values AWS publishes exactly, and the three ISRG pins already
in the repo verified unchanged — so the existing config was correct, just
incomplete.

**Two things the audit did not catch, found while verifying:**

- **ISRG Root YE was missing.** Let's Encrypt's published default ECDSA chain is
  `EE ← YE1 ← Root YE ← ISRG Root X2 ← ISRG Root X1`. X1 being in the chain
  covers it *today*. The moment LE serves the shorter chain terminating at Root
  YE — which happens once YE lands in trust stores — an unpinned YE breaks every
  handshake. Added as a backup pin.
- **The debug and release Android configs duplicated the pin list**, so one could
  silently fall behind the other. A debug build whose pins differ from release
  cannot reproduce a release-only TLS failure, which is the one thing you would
  reach for a debug build to do. Now a single shared constant.

**Build gates added.** The existing gate checks the pins have not *expired*;
these pins were valid and simply absent from the new chain, so it could never
have caught this. `assertAmazonRootsPinned()` now fails the build outright, and
`plugins/__tests__/certificatePinning.test.ts` asserts both hierarchies on both
platforms and that the two platforms pin **exactly the same set**.

---

## High

### 01 · iOS — Apple Watch token could never be revoked — FIXED

- `SyncKey.signOut` added: a **distinct key**, not an empty token. The watch
  guarded on `!token.isEmpty`, so the Android technique would have been a no-op;
  and an empty string is indistinguishable from a truncated payload, which must
  not mean the same thing as "end the session".
- `WatchSyncCoordinator.clearToken()` sends over **both transports always**,
  unlike `pushToken` which prefers the live path. A sign-out only attempted while
  the watch happens to be reachable does not happen when the watch is in another
  room — exactly when it matters. `transferUserInfo` is queued and guaranteed.
- `ServiceContainer.signOut()` calls it, and clears `SnapshotCache` too.
- The watch's handler checks sign-out **first and returns**, because
  `transferUserInfo` makes no ordering promise across transfers — a queued
  snapshot from before sign-out can arrive after it and would otherwise
  repopulate the session that was just ended.

**Adjacent bug found while fixing:** `SnapshotCache.appGroup` was a hardcoded
`group.com.furlpay.guardian`. With the environment suffixes added in the first
pass, dev/staging/prod would have shared one container — the staging app
overwriting the production snapshot, and the production **widget rendering
staging balances on the user's watch face** with no way to tell. Now scoped by
`$(FURLPAY_BUNDLE_SUFFIX)`.

> Requires a matching App Group in each target's `.entitlements` and in the
> developer portal. An unprovisioned group makes `UserDefaults(suiteName:)`
> return nil; every accessor already degrades to "no cached snapshot".

### 02 · Android — two of three sign-out paths skipped the watch — FIXED

Moved the Data Layer clear out of `DashboardViewModel` and into
`AuthManager.signOut()`, the single path every caller already uses — so the 401
handler and account deletion now perform it without having to remember to.

Injected as a `suspend () -> Unit` lambda rather than a `DataLayerManager`
dependency: `:core:sync` pulls in Play Services, and `:core:security` is
otherwise pure JVM and unit-testable without Robolectric.

Failure-isolated with `runCatching`, and ordered **after** the local clear. The
phone's own session must end even when the watch is out of range — otherwise a
user stays signed in on the device in their hand because a device on their wrist
could not be reached.

### 03 · RN — session JWT was the least-protected secret — FIXED

New `lib/storageOptions.ts` names three policies (`DEVICE_ONLY`,
`DEVICE_ONLY_BIOMETRIC`, `BACKGROUND_READABLE`); every policy is
`ThisDeviceOnly`. Applied to the session token, the anti-phishing phrase, the App
Attest key id, the paired-watch name, the install id, and both wallet addresses.

`requireAuthentication` deliberately **not** set on the token: it is read on
every API call including background refreshes, where there is no UI to prompt
with. Same tradeoff the iOS Guardian app documents and resolves the same way.

`lib/__tests__/secureStorePolicy.test.ts` asserts the **shape** of every
SecureStore call site rather than a list of known keys — a new
`setItemAsync(FOO, bar)` added next month fails without anyone remembering the
test exists. (Its first draft produced a false positive on
`setItemAsync(KEY, deriveSolanaAddress(mnemonic), PUBLIC_OPTS)`; a `[^)]*` match
truncates at the nested call's paren. Now paren-balanced.)

---

## Medium

| # | Finding | Fix |
|---|---|---|
| 05 | No source-node verification on the Data Layer | New `PairedNodeGate`. Gates the **credential** path only — a blank token means "session ended", and refusing to act on it because the source was unverifiable would keep a live token on the wrist for the exact reason that should have removed it. Fails closed. |
| 06 | Exported services with no permission guard | `android:permission="com.google.android.gms.permission.BIND_LISTENER"` on `WearListenerService` and `VoiceRelayService`. `exported="true"` is required — GMS delivers from its own process — but that is not a reason to accept callers from every app on the device. |
| 07 | Pinning on one surface of four | Now on all four: `FurlPayPinning.kt` (OkHttp `CertificatePinner`, phone + watch), `CertificatePinner.swift` (SPKI evaluation via `URLSessionDelegate`), and `withIosCertificatePinning.js` (Apple's `NSPinnedDomains`, no new dependency and no call-site changes). |
| 08 | Every iOS request identified as Android | `mobile-${Platform.OS}/${version}`. Preserves the `mobile` prefix the server contract requires. |
| 09 | Wildcard `postMessage` target | `window.location.origin`, matching both sibling content scripts. |
| 10 | `setBaseUrl` accepted any string | Origin allowlist, validated on **read as well as write** — extension storage is writable by anything with profile access, and a value from an older build predates the allowlist. Rejections are surfaced in the UI rather than silently dropped. |
| 11 | `allowBackup` defaulted to true | `false` + `dataExtractionRules` on both guardian manifests. `allowBackup="false"` alone does **not** stop device-to-device transfer; the rules file covers both. |
| 12 | 401 on the watch did nothing | `onUnauthorized` wired on the Wear client. |
| 13 | iOS 401 handling incomplete | `setUnauthorizedHandler` seam on the API client, matching the Kotlin and RN clients. Routes into `sessionExpired()` → full teardown. Single-flight, so six parallel 401s do not race six teardowns; re-armed on the next success. |

**Pinning caveat, stated plainly:** OkHttp and `NSPinnedDomains` have no
equivalent of Android's `<pin-set expiration>` dead-man's switch. A stale pin
there fails **closed, permanently, for everyone** — worse than the Android
failure mode. Mitigated by pinning all roots of both hierarchies rather than only
those in use, plus `pinsVerifiedOn` constants and build-time assertions. Re-verify
yearly.

---

## Low

| # | Finding | Fix |
|---|---|---|
| 14 | OTP rendered from a server field | `__DEV__ &&` in addition to the server's gate — two independent conditions, so a server regression cannot leak an OTP into a shipped app on its own. |
| 15 | "Fingerprint" on Face ID devices | `biometricLabel()` resolves from `supportedAuthenticationTypesAsync()` — what the device actually enrols, not `Platform.OS`. Plenty of Android phones are face-only. Neutral "Biometrics" until resolved; never a confident wrong label. |
| 16 | XHR listener accumulation | One listener per object via a `Symbol` marker, with the method/URL re-read per `open()`. |
| 17 | Keychain delete-then-add window | The previous value is read first and **restored** if the add fails, so a failed refresh costs nothing. The keychain has no transaction; this is the available equivalent. |
| 18 | Deprecated TWA still buildable | `gradle.taskGraph.whenReady` refuses any `*Release` task. A README does not stop `./gradlew bundleRelease`. Override is `-PfurlpayAllowDeprecatedTwaRelease`, deliberately awkward to type. |

---

## AWS hardening added in this pass

From current AWS guidance, on top of the first pass's isolated VPCs, scoped IAM
and assembled secrets:

- **`readonlyRootFilesystem = true`** with explicit volumes for `/tmp` and
  `.next/cache`. Fargate has no tmpfs — that is ECS-on-EC2 only — so writable
  paths must be real volumes. Runs as uid 1000, not root.
- **GuardDuty + ECS Fargate Runtime Monitoring.** Without runtime monitoring
  GuardDuty sees CloudTrail, flow logs and DNS — the network view — but nothing
  inside a task. Findings route to SNS at **severity ≥ 7.0 only**: a Medium/Low
  feed on a busy account teaches the on-call that the topic is noise.
- **ECR with `IMMUTABLE` tags and scan-on-push.** A mutable tag can be moved
  after a deploy, so the task definition stops recording what actually ran — and
  a rollback target that can be repointed is not a rollback target. One
  repository across all three environments, because an image promoted dev →
  staging → prod must be the same bytes.
- **Deployment-failure notifications** via EventBridge, plus the SNS topic policy
  both EventBridge and CloudWatch need (it is not inherited).

---

## Verification

| Check | Result |
|---|---|
| `native-app` jest | **1605 passed, 102 suites** |
| `native-app` `tsc --noEmit` | clean |
| `apps/extension` vitest | **136 passed, 9 files** |
| `apps/extension` `tsc --noEmit` | clean |
| `guardian :core:network` + `:core:security` | BUILD SUCCESSFUL, `:core:network:test` ran |
| `guardian :core:sync` + `:core:data` | BUILD SUCCESSFUL — includes Room KSP codegen for the new `SnapshotDao.clear()` |
| Pin plugin assertions (both platforms) | pass; correctly reject a missing hierarchy |
| Pin values vs. published roots | recomputed with openssl; Amazon hex also matches AWS's published digests |

Gradle needs a working JDK: `JAVA_HOME` on this machine points at a path that
does not exist, and `java` on `PATH` is 1.8. Builds above were run with
`JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.9.10-hotspot"`.

### Not verified — read this before shipping

- **Terraform has never been run.** Not installed on this machine: no `validate`,
  no `plan`, no `apply`. Treat the first plan as real work.
- **No AWS resources exist.** No credentials were used; nothing costs money yet.
- **The Swift changes were not compiled.** No macOS/Xcode here. The iOS work —
  `CertificatePinner.swift`, `AppEnvironment.swift`, the `signOut` and 401
  changes — is reviewed but unbuilt, and Swift 6 strict concurrency is
  unforgiving about exactly the kind of closure capture the 401 handler
  introduces.
- **Guardian's app modules were not assembled.** The four core modules compile,
  but `:app:mobile` and `:app:wear` — which is where the new product flavors,
  the manifest permissions and the `BuildConfig.API_BASE_URL` wiring actually
  land — were not built.
- **No device testing at all.** In particular the watch sign-out paths on both
  platforms, and the `NSPinnedDomains` config, are the kind of thing that can
  only really be confirmed on hardware.

### Recommended before the AWS cutover

1. Build and run the Swift target — the 401 handler's `[weak self]` closure and
   the actor-isolated `setUnauthorizedHandler` are where a strict-concurrency
   error would appear.
2. Assemble `stagingDebug` for phone **and** watch and confirm they pair (CI
   asserts matching `applicationId`, but pairing is the real test).
3. Point a staging build at a real ACM-fronted host and confirm the handshake
   succeeds on Android **and** iOS. This is the one that would otherwise be found
   by users.
