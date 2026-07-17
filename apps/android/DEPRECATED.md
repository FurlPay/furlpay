# apps/android (TWA) — DEPRECATED. Not the Play artifact.

**The app published to Google Play as `com.furlpay.app` is the React Native app
in [`native-app/`](../../native-app).** This directory is not a release target.

## Why this is dangerous, not merely obsolete

Both projects declare the **same package id**, `com.furlpay.app`:

| | `apps/android` (this) | `native-app` (canonical) |
|---|---|---|
| What | Bubblewrap TWA — a browser frame around furlpay.com | Expo / React Native app |
| `versionCode` | 1 | 3 |
| Push (FCM) | none | yes — 3DS2 approvals depend on it |
| Native passkeys | via Chrome | `react-native-passkey` |
| In-app account deletion | no | yes (Play requirement) |
| Signed with | the same upload key | the same upload key |

Only one app can own a Play listing. Because both are signed with the **same
upload key**, a TWA bundle uploaded by mistake would pass every check we have —
`jarsigner -verify`, `verify-assetlinks.sh`, Play's signature check — and
silently replace the real app with a browser frame that has no push, no native
passkeys, and no account-deletion flow. The failure would look like a successful
release.

## What prevents that

1. **`build.sh` refuses to run** unless `FURLPAY_BUILD_DEPRECATED_TWA=1` is set
   explicitly.
2. Its outputs are named **`twa-DEPRECATED-DO-NOT-UPLOAD.aab` / `.apk`** — they
   cannot be confused with `native-app/furlpay-mobile-release.aab`.
3. `native-app/eas.json` records the canonical artifact in its `submit` profile.

## Why the directory still exists

- **`verify-assetlinks.sh`** — the pre-upload check that a build's signing
  certificate is actually published in `assetlinks.json`. `native-app`'s build
  script calls it. It is not TWA-specific and must not be deleted.
- Reference for the TWA's Digital Asset Links / manifest configuration.

The signing keystore is **no longer here** — see [`KEYSTORE-MOVED.md`](./KEYSTORE-MOVED.md).

## The canonical release path

```bash
cd native-app && ./build-android.sh     # -> furlpay-mobile-release.aab
```

See [`docs/ANDROID-RELEASE.md`](../../docs/ANDROID-RELEASE.md).
