# Mobile performance baseline

Companion to `docs/performance/BASELINE.md` (backend, not measured). This file covers the Android/iOS app.

**Environment for this pass:** Windows 11, no Android device or emulator attached, no macOS host. **No runtime metric (cold start, warm start, time-to-interactive, frame times) was measured, and none is reported.**

## 1. Measured

| Metric | Value | How |
|---|---|---|
| Android JS bundle (Hermes bytecode) | **9,464,185 B (9.46 MB)** | `npx expo export --platform android --output-dir .perf-export`, Sep 30 2026, `env=dev` config; largest file `_expo/static/js/android/index-*.hbc` |
| Android export total (bundle + assets) | 13 MB | `du -sh .perf-export` |
| Shipped release AAB | 64,305,804 B | `native-app/furlpay-mobile-release.aab`, built **Aug 1 2026** |
| Shipped universal APK | 109,413,608 B | `native-app/furlpay-mobile-release.apk`, Aug 1 2026 |
| Baseline profile in the shipped APK | **2,366 B** (R8 stub) | `unzip -l furlpay-mobile-release.apk \| grep dexopt` |
| ABIs in the shipped APK | arm64-v8a, armeabi-v7a, **x86, x86_64** | same listing (`lib/*/libhermes.so`) |

The shipped artifacts **predate** `plugins/withAndroidPerformance.js` (ARM-only release ABIs + the curated baseline profile). No release has been built since, so neither change is in any artifact yet.

Competitor reference (from the shipped APKs, recorded in `native-app/android-profile/README.md`): Tangem 6.2.1 baseline profile 27,754 B; RedotPay 3.13.3 12,270 B.

## 2. Not measured — and exactly how to measure

### Cold/warm start, TTID, TTFD (Android)
1. `npx expo prebuild --platform android`
2. Add a `:benchmark` module with `androidx.baselineprofile` **via** `plugins/withAndroidPerformance.js` (`android/` is regenerated; a hand edit vanishes).
3. Journeys (the brief's list, mapped to routes): cold launch `app/_layout.tsx` → unlock `app/(auth)/login.tsx` → home `app/(tabs)/index.tsx` → wallet `app/wallet.tsx` → asset details `app/market/[symbol].tsx` → send `app/(tabs)/send.tsx` → receive `app/receive.tsx` → swap `app/swap.tsx` → transaction review `app/transaction/[id].tsx`.
4. `./gradlew :app:generateReleaseBaselineProfile` on a device → copy to `native-app/android-profile/baseline-prof.txt`.
5. `./gradlew :benchmark:connectedReleaseAndroidTest` with `CompilationMode.None` vs `Partial` → record `timeToInitialDisplayMs` median/p90 over ≥10 iterations here.

### Frame performance
`FrameTimingMetric` in the same macrobenchmark, on the home → wallet scroll and the markets list.

### Binary size after the plugin
`./build-android.sh` → `unzip -l` the APK: confirm `assets/dexopt/baseline.prof` ≫ 2,366 B and no `lib/x86*`.

### iOS
Requires a macOS host with Xcode 16+/26 and a device: Instruments "App Launch" template on a release build. Blocked on the Apple Developer account (see `docs/release/IOS_RELEASE_READINESS.md`).

## 3. Status

| Item | Status |
|---|---|
| Baseline-profile infrastructure (plugin, source-of-truth file, docs) | PASS (exists) |
| Profile generated from real journeys | BLOCKED (device) |
| Cold start measured | BLOCKED (device) |
| Bundle size measured | PASS — 9.46 MB Hermes bytecode |
| Release artifact contains the performance changes | FAIL — last artifact is from Aug 1 |
