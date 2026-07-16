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

## Module layout (built so far)

```
guardian/
├── core/domain/     PURE KOTLIN (JVM). Models + use cases. No Android dep,
│                    so `gradle :core:domain:test` runs on any JVM — 13 tests green.
│     ├── model/     GuardianEvent, EventPriority, ReminderStage, DailyBriefing, GuardianResult
│     ├── usecase/   PrioritizeEventsUseCase, ScheduleRemindersUseCase, GenerateBriefingUseCase
│     └── ai/        GuardianTool / GuardianTools — provider-neutral tool catalog
├── core/ai/         (scaffolded) Firebase-backed clients live in the app modules
├── app/mobile/      (scaffolded) phone brain — Firebase AI Logic, voice relay
└── app/wear/        (scaffolded) Wear OS companion — tiles, complications, alarm
```

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
export JAVA_HOME=<a JDK 17 install>
cd guardian
gradle :core:domain:test        # pure-kotlin logic — no SDK needed
```

The `:app:*` and `:core:ai` Firebase/Android modules need the Android SDK +
a `google-services.json` (gitignored) to assemble; those are scaffolded next.
