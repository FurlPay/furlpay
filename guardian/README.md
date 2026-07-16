# Guardian — FurlPay × Life Guardian AI

A Kotlin **phone app** (the AI "brain") + a **Wear OS companion** for the Google
Pixel Watch 3. Two products in one shell:

- **Life Guardian AI** — a personal AI ops center: events from Gmail / Calendar
  / GitHub / Telegram, ranked and escalated into a never-miss alarm ladder, with
  a voice assistant powered by Gemini (Firebase AI Logic).
- **FurlPay Watch** — a financial companion: balances, card freeze/unfreeze,
  portfolio, spending, and travel, all against the existing `furlpay.com/api`
  with the same session JWT the mobile app uses.

## Status

| Module | State |
|---|---|
| `core/domain` | ✅ **built + 13 unit tests green** (pure Kotlin/JVM) |
| `core/ai` (tool catalog) | ✅ in `core/domain/ai` — provider-neutral, tested |
| `app/mobile`, `app/wear` | 🚧 scaffolded — need Android SDK + `google-services.json` |

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — it records the
**verified** API versions (the seeding plan had several wrong), the security
invariants carried over from the React Native app, and the module rationale.

## Build & test the core (no Android SDK needed)

```bash
export JAVA_HOME=<JDK 17>
cd guardian
gradle :core:domain:test
```

## Known constraints (verified)

- **No tap-to-pay on Wear OS** — Google does not expose a public NFC payment
  API; contactless is locked to Google Wallet. FurlPay Watch shows balances,
  manages cards, and displays receive QR codes.
- **Gemini Nano** (on-device) is Pixel 9+/Galaxy S24+ only; the cloud Gemini
  Live API is the primary engine, Nano an optional offline fallback.
- **AppFunctions** (`@AppFunction`, system-Gemini integration) is Android 16+
  and still alpha — gated behind an SDK-version check.
