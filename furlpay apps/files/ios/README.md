# FurlPay — iOS project

The real iOS native project for the FurlPay wallet, generated from
`native-app/` (Expo SDK 53 / React Native 0.79.6). This is **not** a separate
app: it is the same JavaScript, the same wallet, the same screens that ship on
Android.

Bundle identifier `com.furlpay.app` — the same id as the Android package, so
universal links, push topics and analytics identity stay aligned across stores.

## What is here

```
FurlPay.xcodeproj/          Xcode project + shared scheme
FurlPay/
  AppDelegate.swift         Expo/RN entry point
  Info.plist                permissions, URL schemes, background modes
  FurlPay.entitlements      push, associated domains, keychain group
  Images.xcassets/          app icon + splash assets
  SplashScreen.storyboard
  Supporting/Expo.plist
Podfile                     CocoaPods spec (Hermes, New Architecture)
Podfile.properties.json     deployment target 15.1, hermes, newArch
.xcode.env
```

## What is deliberately NOT here

`Pods/`, `Podfile.lock` and `FurlPay.xcworkspace`.

Those are produced by `pod install`, which is a dependency-install step — the
iOS equivalent of `npm install` — and genuinely requires macOS and CocoaPods.
They are build inputs resolved on the build machine, not source. Shipping a
`.xcworkspace` without the `Pods/` it references would be a broken file that
looks complete, which is worse than its absence.

## Building it

```bash
# on macOS, from the repo root
cd native-app
npm install
npx expo prebuild --platform ios     # regenerates this directory
cd ios && pod install                 # creates Pods/ and FurlPay.xcworkspace
open FurlPay.xcworkspace              # NOT the .xcodeproj
```

Or without a Mac, using EAS (it builds on Expo's macOS workers):

```bash
cd native-app
eas build --platform ios --profile preview      # simulator build, no signing
eas build --platform ios --profile production   # needs an Apple account
```

## Configuration already applied

| Area | Value |
| --- | --- |
| Deployment target | iOS 15.1 (Expo SDK 53 minimum) |
| JS engine | Hermes |
| Architecture | New Architecture (Fabric + TurboModules) |
| Privacy manifest | aggregation enabled |
| URL scheme | `furlpay://` — WalletConnect's return path |
| Universal links | `applinks:furlpay.com`, `applinks:www.furlpay.com` |
| Keychain group | `$(AppIdentifierPrefix)com.furlpay.app` — backs expo-secure-store |
| Push | `aps-environment` + `remote-notification` background mode |
| Queried schemes | metamask, trust, rainbow, ledgerlive, safe, wc |

`LSApplicationQueriesSchemes` matters more than it looks: on iOS `canOpenURL`
returns **false silently** for any scheme not listed, so an unlisted wallet is
indistinguishable from an uninstalled one.

Permission strings are present for camera, Face ID, microphone and speech
recognition. iOS **terminates** an app that touches one of those without its
string — this is a crash, not a warning.

## Native modules

All 27 native dependencies support iOS. The one local module,
`modules/wear-bridge`, declares `"platforms": ["android"]` in its
`expo-module.config.json`, so Expo autolinking skips it on iOS rather than
failing to build — Wear OS has no iOS counterpart, and the Watch companion is a
separate Guardian target.

## Remaining external requirement

A **paid Apple Developer account** for a signed device or App Store build:
distribution certificate, provisioning profile, and an App Store Connect record
for `com.furlpay.app`. `eas.json`'s iOS submit block is deliberately left
without `ascAppId`/`appleTeamId` rather than carrying placeholders — a wrong
`ascAppId` submits this binary to somebody else's app record.

The simulator profile (`--profile preview`) needs none of that and still proves
the native project compiles.
