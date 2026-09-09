# FurlPay — Android release build

Built from `native-app/` at commit `e67ab65` on branch `extension-redesign`.

| | |
| --- | --- |
| Package | `com.furlpay.app` |
| Version | 2.3.0 (versionCode 7) |
| targetSdk / compileSdk | 36 |
| minSdk | 28 |
| ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 |
| JS engine | Hermes (bytecode, not source) |
| Architecture | New Architecture — Fabric + TurboModules |
| APK size | 167 MB |
| JS bundle inside | 5.9 MB (`assets/index.android.bundle`) |

## Installing it

```bash
adb install FurlPay-Android-2.3.0-release.apk
```

Or copy the APK to a phone and open it. Android will ask permission to install
from an unknown source — this is expected for any APK not delivered by Play.

The APK is signed and `apksigner verify` passes:

```
Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown
SHA-256: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
```

## The signing key is the debug key — read this before shipping

`android/app/build.gradle` assigns `signingConfigs.debug` to the **release**
build type. That is React Native's template default and it has two consequences:

1. **This APK installs and runs on any device.** It is a genuine release build —
   R8-minified, obfuscated, resource-shrunk, Hermes bytecode. Good for testing,
   internal distribution and sideloading.

2. **It cannot go to Google Play.** Play rejects the debug certificate, and an
   app signed with a different key than a previously installed one cannot
   upgrade over it. A production release needs a real upload keystore and
   `signingConfigs.release` pointing at it.

Neither problem affects installing this build on a phone today.

## What is actually inside

Verified in the APK, not assumed:

- `assets/index.android.bundle` — 5.9 MB Hermes bundle, all 67 screens
- `lib/{arm64-v8a,armeabi-v7a,x86,x86_64}/libhermes.so` — engine per ABI
- `assets/mlkit_barcode_models/*.tflite` — on-device QR/barcode scanning
- `classes.dex` — 7.3 MB, R8-minified and obfuscated

The bundle carries the full app: self-custodial wallet, WalletConnect v2, swap,
NFT gallery, staking, P2P escrow, UPI, bills, banking, travel, nine locales,
and the security controls (root detection, screen-capture blocking, certificate
pinning).

## Release hardening applied

From `app.json` → `expo-build-properties.android.extraProguardRules`
(6.8 KB, generated into `android/app/proguard-rules.pro` at prebuild):

- **R8 minification + obfuscation** and **resource shrinking**
- **Log stripping** — `Log.v/d/i` and `FLog.v/d/i` removed from release. `w/e`
  deliberately kept: they are what a crash reporter reads, and no secret is
  logged at those levels
- **Crash symbolication preserved** — `SourceFile` + `LineNumberTable` kept with
  `renamesourcefileattribute`, so stack traces stay resolvable against
  `mapping.txt` without disclosing the source layout
- Keep rules for every reflective/JNI dependency actually installed: RN bridge,
  Hermes, Expo modules, passkeys/Credential Manager, MapLibre, SQLite,
  async-storage, netinfo, SVG, screens

`mapping.txt` for this build is at
`C:\b\android\app\build\outputs\mapping\release\mapping.txt` — **keep it** if
this APK is distributed, or its crash reports are unreadable.

## Rebuilding

On Windows this build fails from the normal checkout — see
`native-app/scripts/build-android-windows.md`. It is a 260-character `MAX_PATH`
limit in the Fabric C++ codegen paths, not a configuration problem.

macOS, Linux and EAS have no such limit:

```bash
cd native-app
eas build --platform android --profile production
```
