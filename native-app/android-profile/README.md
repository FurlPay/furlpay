# Android baseline profile

`baseline-prof.txt` here is the **source of truth**. `plugins/withAndroidPerformance.js`
copies it into `android/app/src/main/baseline-prof.txt` on every `expo prebuild`,
because `android/` is gitignored and regenerated.

## Why this exists

A baseline profile lists the classes and methods on the startup path. ART
AOT-compiles them when the app is installed, so the first run does not
interpret them. It is the largest cold-start lever available to a React Native
app, because the RN bring-up and the Hermes bundle evaluation are the same code
on every launch.

Measured from the shipped artifacts (see the competitive audit):

| App | `assets/dexopt/baseline.prof` |
|---|---|
| Tangem 6.2.1 | 27,754 B |
| RedotPay 3.13.3 | 12,270 B |
| **FurlPay 2.3.0 (before)** | **2,366 B** — an R8 stub, not a profile |

2,366 bytes is what R8 emits on its own. It is not a startup profile.

## Current status — read this before quoting a number

The checked-in file is a **hand-curated seed**, not a measured profile. It was
reasoned from the actual startup path (RN runtime → Hermes → Expo module
registry → SQLite/SecureStore → first route), and it is a large improvement on
a 2 KB stub, but it is a superset with wildcards rather than the exact method
list a real run produces.

**No cold-start improvement has been measured**, because generating and
benchmarking a profile requires an Android device or emulator, and this
codebase is developed on Windows without one attached. Do not cite a startup
delta until step 3 below has actually been run.

## Regenerating it properly (do this when a device is available)

### 1. Add the macrobenchmark module

```bash
npx expo prebuild --platform android
```

Then add a `:benchmark` module to `android/` with the
`androidx.baselineprofile` plugin, targeting the app module. Because `android/`
is disposable, the module must be added by a config plugin — extend
`plugins/withAndroidPerformance.js` rather than hand-editing the generated
project, or it will vanish on the next prebuild.

### 2. Write the journeys

The generator drives the real app. Cover the journeys that matter, in the order
a user hits them:

| Journey | Route |
|---|---|
| cold start → first frame | `app/_layout.tsx` |
| login | `app/(auth)/login.tsx` |
| home | `app/(tabs)/index.tsx` |
| wallet | `app/wallet.tsx` |
| send | `app/(tabs)/send.tsx` |
| receive | `app/receive.tsx` |
| scan | `app/scan.tsx` |
| swap | `app/swap.tsx` |
| cards | `app/(tabs)/cards.tsx` |
| banking | `app/banking.tsx` |
| travel | `app/travel/index.tsx` |
| markets | `app/markets.tsx` |
| AI assistant | `app/chat.tsx` |

### 3. Generate, then measure

```bash
# Generate on a connected device or a rooted emulator image
cd android && ./gradlew :app:generateReleaseBaselineProfile

# Copy the result back to the source of truth
cp app/build/outputs/baselineProfiles/baseline-prof.txt ../android-profile/

# Measure cold start BEFORE and AFTER, CompilationMode.None vs .Partial
./gradlew :benchmark:connectedReleaseAndroidTest
```

Record the before/after `timeToInitialDisplay` in this file when you have it.

## Verifying it actually shipped

The profile is only real if it reached the artifact:

```bash
unzip -l furlpay-mobile-release.apk | grep dexopt
# assets/dexopt/baseline.prof   <- must be present and >> 2,366 bytes
```

If that line is missing, the plugin did not run — check that
`./plugins/withAndroidPerformance` is listed in `app.json`'s `plugins` array.
