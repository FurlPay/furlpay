#!/usr/bin/env bash
# Build a SIGNED release AAB of the FurlPay RN app locally (Windows-friendly).
#
# The normal path is EAS:  npm run build:android
#   -> eas.json sets credentialsSource: "local", so EAS signs with the keystore
#      named in credentials.json (the same upload key the TWA used).
# `eas build --local` does not support Windows, hence this script.
#
# THE TRAP THIS AVOIDS: Expo's generated android/app/build.gradle ships
#   release { signingConfig signingConfigs.debug }
# so a plain `gradlew bundleRelease` yields a DEBUG-SIGNED bundle — which Play
# rejects and which would never match assetlinks.json. Rather than patch the
# generated file (prebuild and EAS both overwrite it), we override signing with
# AGP's `android.injected.signing.*` properties, which take precedence over the
# buildType's signingConfig.
#
# Those properties go in android/gradle.properties rather than on the command
# line: the repo path contains a space ("Payment App"), and a -P value with a
# space gets word-split by cmd.exe into a bogus Gradle task name. gradle.properties
# needs no quoting. The file lives in the gitignored, prebuild-regenerated
# android/ dir, and we scrub the secrets from it on exit either way.
#
# Signing material lives OUTSIDE the OneDrive-synced repo tree (a cloud-synced
# keystore + plaintext password is a custody risk): FURLPAY_SIGNING_DIR,
# default C:/Users/ashut/.furlpay-signing. The password is read from
# signing-credentials.txt there, or from FURLPAY_KEYSTORE_PASSWORD if set.
# It is never echoed.
#
# Output: native-app/furlpay-mobile-release.aab
set -euo pipefail
cd "$(dirname "$0")"

JDK="${JDK_HOME:-C:/Users/ashut/.jdks/jdk-17.0.19+10}"
SDK="${ANDROID_HOME:-C:/Android/sdk}"
SIGNING_DIR="${FURLPAY_SIGNING_DIR:-C:/Users/ashut/.furlpay-signing}"
CREDS="$SIGNING_DIR/signing-credentials.txt"
KEYSTORE_REL="$SIGNING_DIR/android.keystore"
GP="android/gradle.properties"
MARKER="# --- injected signing (scrubbed by build-android.sh) ---"

export JAVA_HOME="$JDK"
export ANDROID_HOME="$SDK"

ALIAS="${FURLPAY_KEYSTORE_ALIAS:-$(grep -i '^alias' "$CREDS" | sed 's/.*: *//' | tr -d '\r')}"
PW="${FURLPAY_KEYSTORE_PASSWORD:-$(grep -i '^store password' "$CREDS" | sed 's/.*: *//' | tr -d '\r')}"
[[ -n "$PW" ]] || { echo "ERROR: no keystore password (set FURLPAY_KEYSTORE_PASSWORD)" >&2; exit 1; }

# Never leave the password sitting in the generated properties file — on success
# or on failure.
scrub() {
  [[ -f "$GP" ]] || return 0
  grep -v -e '^android\.injected\.signing' -e '^# --- injected signing' "$GP" > "$GP.tmp" && mv "$GP.tmp" "$GP"
}
trap scrub EXIT

# Mark this as a RELEASE build. app.config.js then refuses to generate a project
# that is missing google-services.json or the federated-auth client ids, instead
# of quietly producing an app with no push and no Google sign-in (which is what
# used to happen on EAS, where the gitignored google-services.json never reached
# the worker). See app.config.js.
export FURLPAY_RELEASE_BUILD=1
# A signed release targets production. Without this, app.config.js resolved the
# environment to "dev" (dev backend, .dev applicationId); it now refuses that.
export FURLPAY_ENV=prod

# EXPO_PUBLIC_* are inlined into the JS bundle at build time. Source them from
# the signing dir (same custody boundary as the keystore, outside the synced
# repo) unless already exported. These are client ids, not secrets — but they are
# environment-specific, and a release without them ships dead sign-in buttons.
RELEASE_ENV="$SIGNING_DIR/release.env"
if [[ -f "$RELEASE_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$RELEASE_ENV"; set +a
fi

echo "==> expo prebuild (regenerate android/)"
npx expo prebuild --platform android

# The prebuild above applies the google-services Gradle plugin ONLY when
# app.config.js set googleServicesFile. Assert the artifact of that, not the
# intent: if this file is absent, FCM is not in the build and push is dead.
[[ -f android/app/google-services.json ]] || {
  echo "ERROR: android/app/google-services.json missing after prebuild — FCM would be absent from this build." >&2
  exit 1
}
grep -q "com.google.gms.google-services" android/app/build.gradle || {
  echo "ERROR: google-services Gradle plugin not applied — FCM would be absent from this build." >&2
  exit 1
}
echo "    Firebase config present and google-services plugin applied."

# `pwd -W`, not `pwd`: Git Bash's pwd yields an MSYS path (/c/Users/...), which
# Gradle reads as a relative Windows path (\c\Users\...) and then reports
# "Missing keystore". -W gives C:/Users/... — forward slashes are fine in a
# .properties value, and so are the spaces in this repo's path.
[[ -f "$KEYSTORE_REL" ]] || { echo "ERROR: keystore not found at $KEYSTORE_REL" >&2; exit 1; }
KEYSTORE_ABS="$(cd "$(dirname "$KEYSTORE_REL")" && pwd -W)/$(basename "$KEYSTORE_REL")"

echo "==> Injecting signing config (upload key: $ALIAS)"
scrub
{
  echo ""
  echo "$MARKER"
  echo "android.injected.signing.store.file=$KEYSTORE_ABS"
  echo "android.injected.signing.store.password=$PW"
  echo "android.injected.signing.key.alias=$ALIAS"
  echo "android.injected.signing.key.password=$PW"
} >> "$GP"

# --- Windows MAX_PATH ------------------------------------------------------
# React Native's New Architecture codegen names each C++ object file after the
# full path of its source, e.g.
#   android/app/.cxx/.../react_codegen_safeareacontext.dir/C_/Users/.../node_modules/
#   react-native-safe-area-context/common/cpp/react/renderer/components/...ShadowNode.cpp.o
# From this repo's home ("OneDrive/Documents/Payment App/native-app") that
# exceeds 260 characters and ninja dies with "Filename longer than 260
# characters". Two things that do NOT fix it, both tried:
#
#   * a directory junction — Gradle canonicalises it straight back to the real
#     long path, so ninja still sees C:\Users\...\Payment App\...
#   * subst'ing the drive at native-app itself — the project then sits at a
#     drive ROOT (X:\), and Metro emits a malformed "X:\/." path and fails with
#     `Unable to resolve module ./node_modules/expo-router/entry.js`.
#
# What works: subst the PARENT (the repo root) so the project is X:\native-app — short
# enough for ninja, and not a drive root, so Metro is happy. EAS builds on
# Linux and never hits any of this.
PARENT_WIN="$(cd .. && pwd -W | sed 's#/#\\#g')"
DRIVE="${FURLPAY_BUILD_DRIVE:-X:}"

echo "==> Mapping $DRIVE -> $PARENT_WIN (short build path)"
powershell.exe -NoProfile -Command "subst $DRIVE /D" >/dev/null 2>&1 || true
powershell.exe -NoProfile -Command "subst $DRIVE '$PARENT_WIN'" >/dev/null
trap 'scrub; powershell.exe -NoProfile -Command "subst '"$DRIVE"' /D" >/dev/null 2>&1 || true' EXIT

# A stale CMake cache pins the previous absolute paths — drop it whenever the
# mapped path changes, or ninja re-fails against the old ones.
rm -rf android/app/.cxx 2>/dev/null || true

echo "==> Gradle bundleRelease, then assembleRelease (from $DRIVE\\native-app\\android)"
# Both artifacts, because they are not interchangeable:
#   .aab -> what Google Play requires (and it cannot be installed on a device)
#   .apk -> what you can actually `adb install` to test on a phone
#
# SEPARATE invocations, deliberately. With resource shrinking enabled, the AAB's
# shrinkBundleReleaseResources and the APK's shrinkReleaseRes BOTH write
# app/build/outputs/mapping/release/resources.txt. Requested in one Gradle run
# they execute concurrently and race, and the loser dies with
#   "Unable to delete file ...\mapping\release\resources.txt"
# after ~16 minutes of work. Running them sequentially costs nothing (the second
# run is almost entirely up-to-date) and is deterministic.
# Driven through PowerShell: `cmd //c "pushd X:\android && gradlew.bat"` does
# not find gradlew.bat on a subst'd drive.
gradle_task() {
  powershell.exe -NoProfile -Command \
    "\$env:JAVA_HOME='$(cygpath -w "$JDK")'; \$env:ANDROID_HOME='$(cygpath -w "$SDK")'; \
     Set-Location '$DRIVE\\native-app\\android'; & .\\gradlew.bat $1 --no-daemon"
}
gradle_task ":app:bundleRelease"
gradle_task ":app:assembleRelease"

cp android/app/build/outputs/bundle/release/app-release.aab furlpay-mobile-release.aab
cp android/app/build/outputs/apk/release/app-release.apk  furlpay-mobile-release.apk
scrub

echo "==> Verify both signatures against the published assetlinks.json"
../apps/android/verify-assetlinks.sh "$(pwd)/furlpay-mobile-release.aab"
../apps/android/verify-assetlinks.sh "$(pwd)/furlpay-mobile-release.apk"

echo "==> Done:"
echo "    furlpay-mobile-release.aab  -> upload to Google Play"
echo "    furlpay-mobile-release.apk  -> adb install -r <this> to test on a device"
