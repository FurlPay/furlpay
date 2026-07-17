# FurlPay Guardian — Wear OS

![Kotlin](https://img.shields.io/badge/Kotlin-2.1-7F52FF?logo=kotlin&logoColor=white)
![Android](https://img.shields.io/badge/Android-SDK_35-3DDC84?logo=android&logoColor=white)
![Wear OS](https://img.shields.io/badge/Wear_OS-4%2B-4285F4?logo=wearos&logoColor=white)
![Jetpack Compose](https://img.shields.io/badge/Jetpack_Compose-Material_3-4285F4?logo=jetpackcompose&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase_AI-Gemini-DD2C00?logo=firebase&logoColor=white)
![Gradle](https://img.shields.io/badge/Gradle-8.10-02303A?logo=gradle&logoColor=white)
![Tests](https://img.shields.io/badge/tests-65_passing-00E599)



https://github.com/user-attachments/assets/5fb04a14-2e23-43c6-a56b-875f2eda55a7



A Kotlin **phone app** (the AI brain) plus a **Wear OS companion** for the
Google Pixel Watch 3. Two products in one shell:

- **Life Guardian AI** — a personal ops center: events ranked and escalated
  into a never-miss, DND-bypassing alarm ladder, with a voice assistant
  powered by Gemini (Firebase AI Logic).
- **FurlPay Watch** — a financial companion: balances, card freeze,
  portfolio, spending, and travel against the existing `furlpay.com/api`
  with the same session JWT the mobile app uses.

## Tech stack

| Layer | Technology |
|---|---|
| Language | Kotlin 2.1, coroutines, kotlinx-serialization, kotlinx-datetime |
| Watch UI | Wear Compose Material 3 (stable 1.5), `TransformingLazyColumn` |
| Phone UI | Jetpack Compose Material 3 |
| Tiles and complications | `androidx.wear.tiles` + protolayout, `watchface-complications-data-source-ktx` |
| AI | Firebase AI Logic — Gemini text (function calling) + Gemini Live (native audio) |
| Networking | Retrofit + OkHttp, kotlinx-serialization converter |
| Persistence | Room (events + snapshot cache), DataStore preferences |
| Security | AndroidKeyStore AES/GCM token store, BiometricPrompt (STRONG) |
| Phone-watch sync | Wearable Data Layer (`DataClient` / `MessageClient`) |
| Alarms | `AlarmManager` exact while-idle, `USAGE_ALARM` haptic waveforms |
| Build | Gradle 8.10, version catalog, 8-module project |

## Modules

| Module | Purpose |
|---|---|
| `core/domain` | Pure Kotlin/JVM: models, use cases, action allowlist registry, voice intent parser — fully unit tested, no Android dependency |
| `core/network` | Pure JVM Retrofit client for `furlpay.com/api` — sliding token refresh, correlation ids, MockWebServer-tested |
| `core/security` | Keystore-encrypted session store, biometric gate, auth state machine |
| `core/sync` | Data Layer wire contract (versioned snapshots), alarm waveforms shared by both devices |
| `core/data` | Room offline cache and DataStore preferences |
| `core/ai` | Gemini clients + fail-closed tool executor |
| `app/mobile` | Phone brain: sign-in, dashboard, watch sync, voice relay, alarm runtime, FCM |
| `app/wear` | Watch app: six screens, six tiles, four complications, alarm service, voice screen |

## Security model

- The AI proposes; it never executes. Every mutating action passes a strict
  allowlist (exact endpoint, method, field types, bounds, a hard USD ceiling)
  and is rebuilt from the registry — unvalidated model output cannot reach
  the network by construction.
- Mutating tools require human confirmation. The executor fails closed: a
  mis-wired path refuses rather than proceeds.
- The watch may freeze a card (protective direction, two-tap confirm);
  unfreezing re-enables spending and stays phone-only behind the biometric.
- The session JWT is AES/GCM-sealed in the AndroidKeyStore on both devices.

## Build and test

```bash
export JAVA_HOME=<JDK 17+>
gradle test            # 65 JVM tests (domain, network, ai)
gradle assembleDebug   # wear-debug.apk + mobile-debug.apk
```

`google-services.json` is required only at runtime for the Gemini and FCM
paths; the build is green without it and the voice pipeline falls back to a
deterministic rule parser.

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it records the
verified API versions, the security invariants, and the module rationale.

## Known constraints (verified)

- No tap-to-pay on Wear OS: Google does not expose a public NFC payment API;
  contactless is locked to Google Wallet. FurlPay Watch shows balances,
  manages cards, and displays receive QR codes.
- Gemini Nano (on-device) is Pixel 9+/Galaxy S24+ only; the cloud Gemini
  Live API is the primary engine.
- AppFunctions (`@AppFunction`, system-Gemini integration) is Android 16+
  and still alpha — gated behind an SDK-version check.
