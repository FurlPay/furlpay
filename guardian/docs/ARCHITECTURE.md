# Guardian — Architecture & Verified-API Decisions

FurlPay × Life Guardian AI: a Kotlin phone app ("the brain") + a Wear OS
companion. This document records **what was verified against official sources**
before any code was written — the implementation plan that seeded this project
had several wrong version numbers and API shapes, and building on those would
have produced a project that doesn't compile.

## Ground-truth corrections (verified July 2026)

| Plan doc claimed | Verified reality | Source |
|---|---|---|
| `wear-compose = "1.6.2"` | **1.5.0 is the stable release** (Aug 2025). 1.6.x is alpha. | developer.android.com/jetpack/androidx/releases/wear-compose-m3 |
| Gemini model `gemini-2.5-flash-native-audio-preview` | `gemini-2.5-flash-native-audio-preview-12-2025` | developer.android.com/ai/gemini/live |
| `Firebase.ai(backend = GoogleAI)` | `Firebase.ai(backend = GenerativeBackend.googleAI())` | Firebase AI Logic docs |
| `Voices.PUCK` | `Voice("FENRIR")` — string constructor | developer.android.com/ai/gemini/live |
| `firebase-bom = "33.12.0"` | current `firebase-bom` line is **34.x** for firebase-ai | Firebase docs |
| `Material3TileService` | Tiles use `TileService` + `androidx.wear.protolayout` | Wear OS Tiles docs |
| `Tool.autoFunction` | ✅ **real** — Firebase type-safe automatic function calling (2026) | firebase.google.com/docs/ai-logic/function-calling |
| `@AppFunction(isDescribedByKDoc = true)` | ✅ **real**, but `androidx.appfunctions` is **1.0.0-alphaNN**, Android 16+ only — gate behind an SDK-version check | developer.android.com/ai/appfunctions |

The tap-to-pay and Gemini-Nano-availability caveats in the plan doc are correct
and stand.

## Module layout (built — 65 tests green, both APKs assemble)

```
guardian/
├── core/domain/     PURE KOTLIN (JVM). Models + use cases + the security core.
│     ├── model/     GuardianEvent, ReminderStage, DailyBriefing, Wallet, Card,
│     │              Transaction, Portfolio, TravelBooking, SpendingSummary
│     ├── usecase/   Prioritize/ScheduleReminders/GenerateBriefing +
│     │              GetWalletOverview, ManageCard, ComputeSpendingSummary
│     ├── action/    GuardianActionRegistry — Kotlin port of the RN co-pilot
│     │              allowlist (field validation, $25k ceiling, body rebuild)
│     ├── repository/ repo contracts (network implements, data decorates)
│     └── ai/        GuardianTools catalog + VoiceCommandParser (deterministic
│                    intent rules — the LLM is the fallback, not the decider)
├── core/network/    PURE JVM. Retrofit/OkHttp client for furlpay.com/api —
│                    Bearer + X-Furlpay-Client (mobile-*) + correlation ids,
│                    single-flight sliding refresh, ActionDispatcher (only
│                    accepts registry-validated actions). MockWebServer-tested.
├── core/security/   KeystoreTokenStore (AES/GCM in AndroidKeyStore — NOT the
│                    deprecated security-crypto), BiometricGate, AuthManager.
├── core/sync/       SyncProtocol (single wire contract: paths + snapshots) +
│                    DataLayerManager / MessageRouter coroutine wrappers.
├── core/data/       Room (guardian_events + snapshot_cache) + DataStore prefs.
├── core/ai/         RepositoryToolExecutor (fail-closed mutating gate) +
│                    GeminiTextAssistant (function calling over GuardianTools)
│                    + GeminiLiveAssistant (native audio, phone-only).
├── app/mobile/      Phone brain: OTP sign-in, dashboard, SyncCoordinator,
│                    VoiceRelayService (rules → Gemini fallback), FCM client.
└── app/wear/        FurlPay Watch: home/wallet/cards/portfolio/spending/voice
                     screens (Wear Compose M3 + TransformingLazyColumn),
                     Wallet + NextEvent + Portfolio tiles (protolayout),
                     Balance/DailySpend/PortfolioChange/NextEvent complications,
                     WearListenerService (token + snapshot inbox).
```

### Design system (app/wear/ui — per the UI/UX bible)

- **theme/GuardianTheme.kt** — AMOLED-first palette (#000 background, A8C7FA
  primary, money-green C3E8C0 / warning FFB77C / error FFB4AB). Compose tokens
  AND protolayout ARGB ints come from the same `FurlPayColors` object so
  screens, tiles, and complications can never drift.
- **Haptics.kt** — the interaction vocabulary: click (any press), heavyClick
  (financial commit — card frozen), doubleClick (answer/money arrived), tick
  (passive transition), error (3×100ms "look at the watch"). ViewModels attach
  a one-shot `HapticCue` to state changes; screens play + clear it. Alarm
  waveforms (USAGE_ALARM) are separate and live with the alarm service.
- **Motion** — voice screen: pulsing listen ring (600ms breathe), spring
  scale-in response card (StiffnessLow + MediumBouncy); list morphing comes
  free from TransformingLazyColumn. No crossfades/parallax/confetti.
- All four bible questions have a surface: How much do I have? (Wallet tile),
  Is my card safe? (Cards), What's next? (NextEvent tile/complication),
  Am I on budget? (Spending screen + DailySpend complication).

### Voice pipeline (built)

```
watch mic (SpeechRecognizer, button-triggered — no wake word)
  → MessageClient /guardian/voice-command → phone VoiceRelayService
      1. VoiceCommandParser (deterministic rules, :core:domain, tested)
      2. no match + Firebase configured → GeminiTextAssistant (same tools)
  → DataClient /guardian/voice-response → watch response card
  phone unreachable → watch runs the SAME parser + executor locally against
  furlpay.com with its synced token (read-only tools; mutating ones refuse).
```

### Watch security posture (decided + enforced in code)

- Session JWT syncs phone → watch over the Data Layer once, then lives in the
  watch's own KeystoreTokenStore; the watch is a first-class API client.
- The watch may FREEZE a card (protective direction, two-tap confirm).
  UNFREEZE re-enables spending → phone-only, behind BiometricGate.
- RepositoryToolExecutor's `confirmMutating` defaults to REFUSE — a mis-wired
  executor fails closed, and background relays can never mutate.
- ActionDispatcher's only input type is `ResolvedConfirmation.Ok`, and the only
  producer of that type is `GuardianActionRegistry.resolve` — unvalidated model
  output cannot reach the network by construction.

### API truths (verified against apps/web route handlers, July 2026)

- `GET /api/wallets` → `balances[].amount` is a STRING; no wallet ids (derive).
- Trips (`/api/travel/trips`) are hotel stays; `/api/travel/itineraries` is
  marketing content, NOT user bookings — the plan doc conflated them.
- No spending-summary endpoint exists: pull `/api/transactions` and compute
  (ComputeSpendingSummaryUseCase — deterministic, tested).
- `/api/auth/refresh` and `/api/auth/otp/check` return the token in the BODY
  only when `X-Furlpay-Client` starts with `mobile` — the client header is
  load-bearing, not cosmetic.

### Why the domain is pure Kotlin

The app's real decisions — how events are ranked, when alarms escalate, which
tools require human confirmation — live in `:core:domain`, which has **no
Android dependency**. That means:

- it compiles and tests on a bare JVM (proven: `BUILD SUCCESSFUL`, 13/13), no
  emulator or Android SDK required;
- the Firebase/Wear/Android layers are thin adapters over logic that is already
  verified;
- the tool catalog (`GuardianTools`) is one testable source of truth shared by
  BOTH the Gemini Live-API path and the `@AppFunction` system-Gemini path,
  rather than duplicated.

## Security invariants (carried from the RN app)

- **Human-in-the-loop on money.** `GuardianTools.mutating` marks `freezeCard`
  and `setReminder`; the app layer MUST require a biometric before dispatching
  any mutating tool — the same rule `native-app/lib/copilotActions.ts` enforces.
- **Reuse the FurlPay session JWT.** The watch/phone authenticate against the
  existing `furlpay.com/api` with the Bearer token, not a separate identity.
- **Alarm haptics use `USAGE_ALARM`** so CRITICAL escalation bypasses DND —
  encoded in `ReminderStage.bypassDnd`, set true for every CRITICAL stage.

## Verified logic (unit-tested, deterministic)

- **PrioritizeEventsUseCase** — effective priority = max(model priority,
  time-urgency); an imminent MEDIUM outranks a distant HIGH; acknowledged sinks
  below active. The LLM proposes; this pure rule decides the feed order.
- **ScheduleRemindersUseCase** — CRITICAL → 4-stage DND-bypassing ladder
  (−60/−15/−5/0 min, GENTLE→MAX); past pre-stages drop but the at-time MAX
  always survives a late arm.
- **GenerateBriefingUseCase** — AI writes the prose; counts + lead event are
  computed here so the numbers are right even if the model's text disagrees.

## Build

```bash
export JAVA_HOME=<a JDK 17+ install>     # e.g. C:\Program Files\Microsoft\jdk-21...
cd guardian
gradle test                # 65 JVM tests (domain + network + ai) — all green
gradle assembleDebug       # wear-debug.apk + mobile-debug.apk (SDK 35)
```

`google-services.json` is needed only AT RUNTIME for Firebase (Gemini + FCM).
Without it the build is green, FCM stays dormant, and the voice pipeline runs
on the deterministic rule parser. Drop the file into `app/mobile/` (and apply
the google-services plugin) when the Firebase project exists.

## Remaining (next phases)

- Firebase project + `google-services.json` → activates Gemini + FCM paths.
- Alarm ladder runtime: AlarmManager + full-screen intent + USAGE_ALARM
  haptics on both devices (ScheduleRemindersUseCase already decides staging).
- Gmail/Calendar/GitHub ingestion → EventRepository (Life Guardian feed).
- Phone-side Live-API voice screen; watch Portfolio/Travel tiles; briefing
  worker; Hilt if the graph ever justifies it.
