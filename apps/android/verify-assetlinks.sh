#!/usr/bin/env bash
# Check that a built Android artifact's signing certificate is actually listed in
# the live Digital Asset Links file.
#
# Why this exists: if the cert that signs the app is NOT in assetlinks.json,
# Android silently refuses to verify the app links. For the TWA that is fatal —
# Chrome renders it with a browser URL bar, which defeats the entire point. For
# the RN app, deep links just stop opening the app. Neither failure throws an
# error anywhere; you simply ship a broken app. So verify it, every release.
#
# THE TRAP: Google Play re-signs your upload with the Play App Signing key. The
# fingerprint on real user devices is therefore NOT the one in your local
# keystore. After the first Play upload you must add the App Signing cert
# (Play Console → Test and release → App integrity → App signing key
# certificate) to assetlinks.json, ALONGSIDE the upload key.
#
# Usage:
#   ./verify-assetlinks.sh [path-to.apk|path-to.aab]   (default: furlpay-release.apk)

set -euo pipefail
cd "$(dirname "$0")"

ARTIFACT="${1:-furlpay-release.apk}"
JDK="${JDK_HOME:-C:/Users/ashut/.jdks/jdk-17.0.19+10}"
SDK="${ANDROID_HOME:-C:/Android/sdk}"
BT="${BUILD_TOOLS:-$SDK/build-tools/36.0.0}"
ASSETLINKS_URL="${ASSETLINKS_URL:-https://furlpay.com/.well-known/assetlinks.json}"

[[ -f "$ARTIFACT" ]] || { echo "ERROR: no such artifact: $ARTIFACT" >&2; exit 1; }

# Colon-separated uppercase hex, the form assetlinks.json uses.
to_colons() { tr -d ' :\r\n' | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//'; }

echo "==> Artifact: $ARTIFACT"
case "$ARTIFACT" in
  *.apk)
    # APKs from AGP are signed with APK Signature Scheme v2/v3 and often carry
    # NO v1 (JAR) signature at all. `keytool -printcert -jarfile` reads only v1,
    # so on a modern APK it prints nothing and this check would silently pass on
    # an empty fingerprint. apksigner understands v1/v2/v3 — use it.
    FP=$("$JDK/bin/java.exe" -jar "$BT/lib/apksigner.jar" verify --print-certs "$ARTIFACT" 2>/dev/null \
          | grep -i "certificate SHA-256 digest" | head -1 | sed 's/.*digest: *//' | to_colons)
    ;;
  *)
    # AABs are JAR-signed, which keytool reads directly.
    FP=$("$JDK/bin/keytool" -printcert -jarfile "$ARTIFACT" 2>/dev/null \
          | grep -i "SHA256:" | head -1 | sed 's/.*SHA256: *//' | to_colons)
    ;;
esac
[[ -n "$FP" ]] || { echo "ERROR: artifact is unsigned, or its signature could not be read" >&2; exit 1; }
echo "    signing cert SHA-256: $FP"

echo "==> Fetching $ASSETLINKS_URL"
PUBLISHED=$(curl -fsS "$ASSETLINKS_URL" | tr -d ' \r\n' | grep -oE '[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){31}' | tr 'a-f' 'A-F' | sort -u)
[[ -n "$PUBLISHED" ]] || { echo "ERROR: no SHA-256 fingerprints published" >&2; exit 1; }

echo "    published fingerprints:"
while read -r p; do echo "      $p"; done <<< "$PUBLISHED"

if grep -qxF "$FP" <<< "$PUBLISHED"; then
  echo
  echo "OK: this artifact's certificate IS published. App links will verify for it."
  echo "NOTE: if this build goes through Google Play, Play re-signs it — add the"
  echo "      Play App Signing fingerprint to assetlinks.json too, or links break"
  echo "      for every Play user while still passing this check locally."
  exit 0
fi

echo
echo "FAIL: this artifact's certificate is NOT in assetlinks.json." >&2
echo "      App links will NOT verify. Add $FP to the sha256_cert_fingerprints array." >&2
exit 1
