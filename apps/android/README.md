# Furlpay Android (Trusted Web Activity) — SUPERSEDED

> **Do not publish this app.** It has been replaced by the native React Native
> app in `native-app`, which ships the **same package id** (`com.furlpay.app`)
> at a higher `versionCode` (2 vs 1). Only one of the two can own the Play
> listing, and `native-app` is the one we ship. See `docs/ANDROID-RELEASE.md`.
>
> This directory is kept for two reasons, both of which matter:
> 1. **`android.keystore` lives here** — it is the signing identity of
>    `com.furlpay.app` and `native-app` signs with it (via `credentials.json`).
>    Deleting this directory would destroy the ability to ever update the app.
> 2. `verify-assetlinks.sh` — the pre-upload check that a build's certificate is
>    actually published in `assetlinks.json`.

The Furlpay Android app is a **Trusted Web Activity (TWA)** that wraps
`https://furlpay.com` in a native Android shell. It runs the existing web app
full-screen (no browser UI) and reuses the same auth — including **passkeys**,
which work natively because of the Digital Asset Links binding.

There is no separate UI codebase: the app *is* the website. To change the app,
change the web app and deploy. Only bump the app version + re-upload the bundle
when you need Play-store-level changes (new icon, package config, target SDK).

## One-time prerequisites

| Need | Where | Notes |
|------|-------|-------|
| Node.js 18+ | already installed | runs Bubblewrap |
| JDK 17 | Bubblewrap can auto-install | required to build the `.aab` |
| Android SDK | Bubblewrap can auto-install | build tools + platform |
| Google Play Console account | https://play.google.com/console | **$25 one-time**, verify identity (2–3 days for orgs) |

Install the Bubblewrap CLI:

```bash
npm i -g @bubblewrap/cli
```

## Build

The Android project is already generated (`app/`, `build.gradle`, `gradlew`) from
`twa-manifest.json`. A signed release AAB + APK are produced by:

```bash
FURLPAY_KEYSTORE_PASSWORD=<store-pass> ./build.sh
```

Outputs (git-ignored):
- **`furlpay-release.aab`** — upload this to Google Play.
- **`furlpay-release.apk`** — sideload for device testing: `adb install furlpay-release.apk`.

> **Windows note:** `bubblewrap build` fails under Git Bash because it can't spawn
> `gradlew.bat` (Windows `NoDefaultCurrentDirectoryInExePath`). `build.sh` drives
> Gradle directly (`.\gradlew.bat`) and signs with `jarsigner` (AAB) +
> `apksigner` (APK), which is what Bubblewrap would have done internally.

### Regenerating the project from twa-manifest.json

If you edit `twa-manifest.json`, regenerate the Android project with:

```bash
bubblewrap update --skipVersionUpgrade
```

Then re-apply two values Bubblewrap leaves wrong for our setup, in `app/build.gradle`:
`targetSdkVersion 36` (Bubblewrap defaults to 35) and `versionName "1.0.0"`
(left empty by `--skipVersionUpgrade`). Then run `./build.sh`.

### Toolchain (already provisioned on this machine)
- JDK 17: `C:\Users\ashut\.jdks\jdk-17.0.19+10`
- Android SDK: `C:\Android\sdk` (API 36, build-tools 34.0.0 + 36.0.0). A `tools`
  junction → `cmdline-tools\latest` exists so Bubblewrap can find `sdkmanager`.
- Bubblewrap config: `C:\Users\ashut\.bubblewrap\config.json`

## Wire up Digital Asset Links (REQUIRED — or the app shows a URL bar)

The app is only "trusted" (full-screen, passkey-capable) if `furlpay.com`
publicly vouches for it. That file already exists at
`apps/web/public/.well-known/assetlinks.json` but has a **placeholder
fingerprint**. Replace it with the real one:

1. Use **Play App Signing** (recommended — Google holds the upload/signing keys
   safely). After creating the app in Play Console:
   `Release > Setup > App signing` → copy the **SHA-256 certificate fingerprint**.
2. Paste it into `sha256_cert_fingerprints` in
   `apps/web/public/.well-known/assetlinks.json` (replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`).
3. Deploy the web app so the file is live at
   `https://furlpay.com/.well-known/assetlinks.json`.
4. Verify: https://developers.google.com/digital-asset-links/tools/generator

> If you self-manage the signing key instead, get the fingerprint with:
> `keytool -list -v -keystore android.keystore -alias furlpay`

## Publish to Play

1. Play Console → **Create app** → package name **`com.furlpay.app`** (permanent).
2. Category: **Finance**. Complete: Data safety form, Content rating,
   Privacy policy URL (`https://furlpay.com/legal/privacy`), Target audience.
3. Upload the `.aab` to a **Closed testing** track first, then Production.
4. Confirm `assetlinks.json` is live *before* release, or the app opens with a
   visible address bar.

## Google Play policy — financial app

Furlpay is a payments/finance app, so Play's **Financial Services** policy
applies and is stricter than for a normal app. Expect to:

- Declare the financial features in the Play Console **Financial features**
  declaration form.
- Provide, where required by region, proof of licensing/registration for
  regulated activities (payments, crypto, investments). Google may reject or
  hold a fintech app without this.
- Meet Data safety + secure-handling requirements for financial/PII data.

This is the most likely source of publishing delay — worth reviewing the policy
before submitting: https://support.google.com/googleplay/android-developer/answer/9876821

## Version bumps

Edit `appVersionCode` (integer, must increase every upload) and
`appVersionName` in `twa-manifest.json`, then `bubblewrap update && bubblewrap build`.
