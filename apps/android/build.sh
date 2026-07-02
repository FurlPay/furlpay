#!/usr/bin/env bash
# Build + sign the Furlpay TWA release artifacts.
#
# Why not `bubblewrap build`? On Windows Git Bash, Bubblewrap fails to spawn
# `gradlew.bat` (NoDefaultCurrentDirectoryInExePath), so we drive Gradle directly
# and sign with the Android build-tools ourselves. Produces:
#   furlpay-release.aab  -> upload to Google Play
#   furlpay-release.apk  -> sideload for device testing (adb install)
#
# Requires: JDK 17, Android SDK (API 36 + build-tools 34/36), keystore present.
# The keystore password must be provided via env var:
#   FURLPAY_KEYSTORE_PASSWORD=... ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

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
cp app/build/outputs/bundle/release/app-release.aab furlpay-release.aab
"$JDK/bin/jarsigner" -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" -storepass "$PW" furlpay-release.aab "$ALIAS"
"$JDK/bin/jarsigner" -verify furlpay-release.aab | grep -i verified

echo "==> Sign APK (zipalign + apksigner)"
"$BT/zipalign.exe" -f 4 app/build/outputs/apk/release/app-release-unsigned.apk furlpay-aligned.apk
"$JDK/bin/java.exe" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$PW" --ks-key-alias "$ALIAS" \
  --out furlpay-release.apk furlpay-aligned.apk
rm -f furlpay-aligned.apk
"$JDK/bin/java.exe" -jar "$BT/lib/apksigner.jar" verify --print-certs furlpay-release.apk | grep -i "SHA-256"

echo "==> Done. Artifacts:"
ls -la furlpay-release.aab furlpay-release.apk
