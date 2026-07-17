#!/usr/bin/env bash
# Build + sign the Furlpay TWA release artifacts.
#
# ############################################################################
# # DEPRECATED — THIS IS NOT THE PLAY ARTIFACT. See ./DEPRECATED.md.         #
# ############################################################################
#
# This TWA and native-app BOTH declare the package id com.furlpay.app. Only one
# of them can ever own the Play listing, and the canonical app is the React
# Native one in native-app/ (versionCode 3, vs 1 here). Uploading this bundle
# would take the listing with a browser-frame app that has no FCM, no native
# passkey module, and no in-app account deletion — and, because it would be
# signed with the SAME upload key, every pre-upload check we have would pass.
#
# Hence the guard below: this script no longer builds by default.
#
# Why not `bubblewrap build`? On Windows Git Bash, Bubblewrap fails to spawn
# `gradlew.bat` (NoDefaultCurrentDirectoryInExePath), so we drive Gradle directly
# and sign with the Android build-tools ourselves. Produces:
#   twa-DEPRECATED-DO-NOT-UPLOAD.aab  -> reference only; NEVER upload to Play
#   twa-DEPRECATED-DO-NOT-UPLOAD.apk  -> sideload for comparison (adb install)
#
# Requires: JDK 17, Android SDK (API 36 + build-tools 34/36), keystore present.
# The keystore password must be provided via env var:
#   FURLPAY_KEYSTORE_PASSWORD=... ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

# --- deprecation guard -------------------------------------------------------
# The Play artifact is native-app. Building this one is only ever a deliberate,
# explained act (comparing behaviour, reproducing an old bug) — never a step in
# a release. Make that a decision someone has to make on purpose.
if [[ "${FURLPAY_BUILD_DEPRECATED_TWA:-}" != "1" ]]; then
  cat >&2 <<'GUARD'

  REFUSING TO BUILD — the TWA is deprecated and is NOT the Play artifact.

  The app published as com.furlpay.app is the React Native app:

      cd native-app && ./build-android.sh     # -> furlpay-mobile-release.aab

  Both projects declare com.furlpay.app and are signed with the same upload
  key, so a TWA bundle uploaded by mistake would pass every signature and
  assetlinks check we run — and silently replace the real app on Play with a
  browser frame that has no push, no native passkeys and no account deletion.

  If you genuinely need the TWA artifact for reference (not for release):

      FURLPAY_BUILD_DEPRECATED_TWA=1 ./build.sh

  It will be named twa-DEPRECATED-DO-NOT-UPLOAD.* so it cannot be confused
  with the release bundle. See apps/android/DEPRECATED.md.

GUARD
  exit 1
fi

echo "!! Building the DEPRECATED TWA. This artifact must never be uploaded to Play."

JDK="${JDK_HOME:-C:/Users/ashut/.jdks/jdk-17.0.19+10}"
SDK="${ANDROID_HOME:-C:/Android/sdk}"
BT="$SDK/build-tools/36.0.0"
ALIAS="furlpay"
KEYSTORE="android.keystore"

if [[ -z "${FURLPAY_KEYSTORE_PASSWORD:-}" ]]; then
  echo "ERROR: set FURLPAY_KEYSTORE_PASSWORD (see .signing-credentials.txt)" >&2
  exit 1
fi
PW="$FURLPAY_KEYSTORE_PASSWORD"

export JAVA_HOME="$JDK"
export ANDROID_HOME="$SDK"

echo "==> Gradle build (assembleRelease + bundleRelease)"
cmd //c ".\\gradlew.bat :app:assembleRelease :app:bundleRelease --no-daemon"

echo "==> Sign AAB (jarsigner)"
cp app/build/outputs/bundle/release/app-release.aab twa-DEPRECATED-DO-NOT-UPLOAD.aab
"$JDK/bin/jarsigner" -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" -storepass "$PW" twa-DEPRECATED-DO-NOT-UPLOAD.aab "$ALIAS"
"$JDK/bin/jarsigner" -verify twa-DEPRECATED-DO-NOT-UPLOAD.aab | grep -i verified

echo "==> Sign APK (zipalign + apksigner)"
"$BT/zipalign.exe" -f 4 app/build/outputs/apk/release/app-release-unsigned.apk furlpay-aligned.apk
"$JDK/bin/java.exe" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$PW" --ks-key-alias "$ALIAS" \
  --out twa-DEPRECATED-DO-NOT-UPLOAD.apk furlpay-aligned.apk
rm -f furlpay-aligned.apk
"$JDK/bin/java.exe" -jar "$BT/lib/apksigner.jar" verify --print-certs twa-DEPRECATED-DO-NOT-UPLOAD.apk | grep -i "SHA-256"

echo "==> Done. Artifacts:"
ls -la twa-DEPRECATED-DO-NOT-UPLOAD.aab twa-DEPRECATED-DO-NOT-UPLOAD.apk
