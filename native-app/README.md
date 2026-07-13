# FurlPay Mobile (native Android)

React Native replacement for the `apps/android` TWA wrapper. Expo SDK 53 +
expo-router, offline-first SQLite cache, biometric auth, same backend
(`furlpay.com/api/*`) — zero backend forks.

## Why this is NOT an npm workspace

The repo root `package.json` lists workspaces explicitly (`apps/web`,
`apps/desktop`, `apps/extension`) so this app's React 19 / react-native tree
never hoists into the Next.js 14 web app. Install here directly:

```bash
cd native-app
npm install
```

## Architecture

| Layer | Choice |
|:---|:---|
| Routing | expo-router 5 (file-based, `app/`) |
| State | zustand (`lib/auth.ts`) + TanStack Query (`lib/queries.ts`) |
| Offline | expo-sqlite (`lib/db.ts`): kv snapshots + normalized transactions + outbox |
| Secure storage | expo-secure-store → Android Keystore (session JWT) |
| Biometrics | expo-local-authentication — app unlock + per-send confirmation |
| Send rail | `POST /api/wallets/transfer` (demo signature, Idempotency-Key; queued offline) |
| Auth | Email OTP → `/api/auth/otp/check` with `X-Furlpay-Client: mobile-*` returns the session JWT in the body; sent as `Authorization: Bearer` (server support in `apps/web/src/lib/session.ts::tokenFromRequest`) |

Point the app at a local backend with `EXPO_PUBLIC_API_BASE=http://10.0.2.2:3000/api npx expo start`.

## Dev loop

```bash
npx expo start          # Metro + Expo Go (camera/biometrics need a dev build)
npx expo run:android    # full native dev build on emulator/device
npx tsc --noEmit        # typecheck
npx expo export --platform android  # bundle smoke test
```

## Release build — Play Store continuity

Play identifies the app by **package name + signing key**. Both carry over
from the TWA:

- `app.json` → `android.package: "com.furlpay.app"`, `versionCode: 2`
  (the TWA shipped versionCode 1 — always bump strictly higher).
- Sign with the SAME keystore: `apps/android/android.keystore`, alias
  `furlpay` (credentials in `apps/android/.signing-credentials.txt`).
  **Never lose that file** — see the warning in `apps/android/README.md`.

### Local build (no EAS account needed)

```bash
npx expo prebuild --platform android          # generates android/ (gitignored)
cp ../android/android.keystore android/app/furlpay-upload.keystore
# add to android/app/build.gradle signingConfigs:
#   release {
#     storeFile file('furlpay-upload.keystore')
#     storePassword System.getenv('FURLPAY_UPLOAD_STORE_PASSWORD') ?: findProperty('FURLPAY_UPLOAD_STORE_PASSWORD')
#     keyAlias 'furlpay'
#     keyPassword System.getenv('FURLPAY_UPLOAD_KEY_PASSWORD') ?: findProperty('FURLPAY_UPLOAD_KEY_PASSWORD')
#   }
# and point buildTypes.release at signingConfigs.release. Then:
cd android
FURLPAY_UPLOAD_STORE_PASSWORD=... FURLPAY_UPLOAD_KEY_PASSWORD=... \
  ./gradlew :app:bundleRelease :app:assembleRelease
# → app/build/outputs/bundle/release/app-release.aab (Play upload)
# → app/build/outputs/apk/release/app-release.apk  (sideload)
```
Passwords are in `apps/android/.signing-credentials.txt` (never commit them).

### EAS build

```bash
eas credentials   # import apps/android/android.keystore (alias furlpay) once
npm run build:android
```

After the first Play upload, add the **Play App Signing** SHA-256 as a second
fingerprint in `apps/web/public/.well-known/assetlinks.json` (also required
for this app's `autoVerify` deep links, same as the TWA).

## Deliberately not in v1

- **Push notifications** — needs a Firebase project + FCM server key and a
  mobile token registration endpoint (`/api/push/subscribe` is web-push only).
- **Passkey login** — email OTP first; Credential Manager passkeys later.
- **Real on-chain sends from mobile** — `POST /api/wallets/transfer` is the
  demo ledger rail (503 in prod by design); the gasless EIP-3009 rail needs a
  wallet key on device to sign authorizations.
- **In-app investing orders / card issuance** — read-only screens first.
