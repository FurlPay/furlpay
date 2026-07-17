# FurlPay Mobile (native Android)

React Native replacement for the `apps/android` TWA wrapper. Expo SDK 53 +
expo-router, offline-first SQLite cache, biometric auth, same backend
(`furlpay.com/api/*`) — zero backend forks.

**This is the canonical Google Play artifact for `com.furlpay.app`.** The TWA in
`apps/android` shares the package id and must never be uploaded — see
`apps/android/DEPRECATED.md`.

## Release configuration (REQUIRED — a release build fails without it)

`google-services.json` is gitignored, and **EAS Build uploads the project via git**.
So on an EAS worker the file is simply absent. `app.config.js` used to shrug and
carry on, which produced a build with **no Firebase → no FCM → no 3DS2 approval
pushes**, silently (`lib/push.ts` fails soft by design). The build went green.

`app.config.js` now **throws** on a release build that is missing any of the
following, rather than shipping a crippled app. Configure them once:

```bash
# Firebase config, as an EAS FILE secret (keeps it out of git)
eas secret:create --scope project --type file \
  --name GOOGLE_SERVICES_JSON --value ./google-services.json

# Federated sign-in client ids (inlined into the bundle at build time)
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value <id>
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID     --value <id>
eas secret:create --scope project --name EXPO_PUBLIC_APPLE_CLIENT_ID          --value <services-id>   # optional
```

EAS exposes a file secret as an env var holding the **path** to the file on the
worker; `app.config.js` accepts either that or a local `./google-services.json`.
Nothing secret is printed on failure — only the name of the missing key.

> The Android OAuth client ids do not exist yet: no signing certificate has been
> registered with Firebase. See `docs/PLAY-SIGNING-RUNBOOK.md`.

| Build path | Release? | Behaviour when config is missing |
|:---|:---|:---|
| `eas build --profile production` | yes | **fails** (`EAS_BUILD_PROFILE=production`) |
| `./build-android.sh` | yes | **fails** (sets `FURLPAY_RELEASE_BUILD=1`) |
| `expo run:android`, `--profile development` | no | warns, and push / federated sign-in are inactive |

`build-android.sh` additionally asserts, after prebuild, that
`android/app/google-services.json` exists and the google-services Gradle plugin
was applied — verifying the artifact, not the intent.

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

## Built since the v1 cut

- **Passkey login** — Credential Manager passkeys (`lib/passkey.ts`); the
  server accepts the app's `android:apk-key-hash` origin via
  `FURLPAY_ANDROID_CERT_SHA256`.
- **Native 3DS2 approve** — the approvals screen runs the WebAuthn ceremony
  in-app (`approveCardChallenge`); the web page remains the fallback for
  devices without Credential Manager.
- **Push (FCM) code path** — `lib/push.ts` registers the device token with
  `POST /api/push/devices`; the server fans out via `apps/web/src/lib/fcm.ts`
  inside the same `sendPushToUser` the 3DS2 webhook already calls. Activation
  needs only credentials: drop `google-services.json` here (picked up by
  `app.config.js`, gitignored) and set `FURLPAY_FCM_SERVICE_ACCOUNT` on the
  server. Until then push fails soft and approvals stay pull-based.

- **Support center** — `app/support.tsx`: tickets via the same
  `/api/support/tickets` registry as web (server-side PII redaction included),
  help articles via the in-app browser.
- **Passkey manager** — `app/passkeys.tsx`: list/enroll/revoke against
  `/api/auth/passkey/credentials` (route made Bearer-aware server-side).
- **Notification inbox** — pushes persist to SQLite (`notifications` table,
  migration v3); `app/notifications.tsx` lists them with tap-through routing.
- **Card issuance** — `CreateCardModal` in the cards tab, `POST /api/cards`
  (server enforces verified KYC), biometric-gated.
- **Order history** — Invest → "Order history" deep-links the transactions
  screen with `?category=invest` (orders are recorded as transactions).

- **Self-custodial wallet** (`app/wallet.tsx`, `lib/wallet.ts`) — a REAL
  secp256k1 key generated on device from device entropy, held encrypted in the
  Android Keystore (expo-secure-store `requireAuthentication` — decryption
  needs a biometric), BIP-39 recovery phrase for backup, FLAG_SECURE on the
  seed screen. Signs real EIP-3009 `transferWithAuthorization` (EIP-712),
  byte-identical to the server verifier — proven against a viem oracle in
  `lib/__tests__/wallet.test.ts` (address, digest, sign→recover). Sends relay
  through `POST /api/transfers/gasless` (the hardened real rail). Settlement
  still requires the server in live mode with a configured relayer key + RPC;
  until then a send signs honestly and reports "settlement unavailable" — it
  NEVER fabricates a transfer. Pure-JS crypto (`@noble/*`, `@scure/*`), no
  native modules.

## Deliberately not in v1

- **Account balance ↔ device wallet reconciliation** — the FurlPay account's
  displayed balance lives at the server-derived `safeAddress`; the device
  wallet is a distinct real address. Linking them (so "send from my balance"
  uses the device key) is a server account-model change, tracked separately.
- **Real on-chain sends from the main Send tab** — still the demo ledger rail
  (`/api/wallets/transfer`, 503 in prod). The real signed path lives in the
  self-custodial wallet screen above.
- **Card issuance** — demo PAN/CVV until an issuing partnership exists.
