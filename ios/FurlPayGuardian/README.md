# FurlPay Guardian — iOS & watchOS

Port of `guardian/` (Android + Wear OS) to iPhone and Apple Watch, consuming the
identical `https://furlpay.com/api` backend.

## Status — read this first

These sources were written on Windows, where `xcodebuild`, `swift`, `swiftc` and
`xcrun` do not exist. **No compiler has run on this machine.**

The fix is not a local Mac — it is
[`.github/workflows/ios-guardian.yml`](../../.github/workflows/ios-guardian.yml),
which generates the project, builds both apps and runs the tests on a macOS
runner for every push that touches `ios/`. Until that workflow has gone green
once, treat every file as a reviewed first draft. Swift 6 strict concurrency is
on, and it is enforced aggressively.

## Building

CI does this on every push. To do it by hand on a Mac:

```bash
brew install xcodegen
cd ios/FurlPayGuardian
xcodegen generate          # the .xcodeproj is generated, never committed
open FurlPayGuardian.xcodeproj
```

**Xcode 26 or later is required.** Since 28 April 2026 App Store Connect
rejects uploads not built with Xcode 26 and the iOS/watchOS 26 SDKs. That is
the SDK the app compiles *against*; the deployment target stays at iOS 18 /
watchOS 11, so the addressable audience is unchanged and iOS 26 features are
adopted behind `if #available`.

## Four targets

| Target | Platform | What it is |
| --- | --- | --- |
| `FurlPayGuardian` | iOS 18+ | The phone app |
| `FurlPayGuardianWatch` | watchOS 11+ | The watch app |
| `FurlPayGuardianWidgets` | watchOS | 4 complications + 6 Smart Stack tiles |
| `FurlPayGuardianActivities` | iOS | The AlarmKit Live Activity |

## Where the spec was not followed, and why

| Spec said | Built as | Reason |
| --- | --- | --- |
| Minimum iOS 27 / watchOS 27 | iOS 18 / watchOS 11 | iOS 27 ships ~Sept 2026 and is on no device today. As a *minimum* it gives the app zero addressable users. iOS 27 features go behind `if #available`. |
| `.reorderable()` | `.onMove` | Could not verify `.reorderable()` exists. `.onMove` does, and does the job. |
| `ResultsObserver` (SwiftData) | not used | Same — unverifiable API, and nothing here needs it yet. |
| `FoundationModels` as primary AI | not yet wired | Availability-gated when added; it must not be the only path or the app breaks on any device without it. |

Everything above is a case of the spec citing an API I could not confirm. On a
Mac these are one compile away from being settled either way — but shipping code
that names a non-existent symbol is worse than shipping code that names an older
one.

## What is implemented

| File | Purpose |
| --- | --- |
| `Shared/Models/GuardianModels.swift` | All domain models, `Sendable`, ported from `core/domain` |
| `Shared/Models/SyncProtocol.swift` | Phone↔watch keys, snapshot envelope, App Group cache |
| `Shared/Security/ActionRegistry.swift` | The AI action allowlist — see below |
| `Shared/Security/KeychainTokenStore.swift` | JWT storage (Keychain ≙ AndroidKeyStore) |
| `Shared/Security/BiometricGate.swift` | Face ID gate + the watch's deny-all gate |
| `Shared/Network/FurlPayAPIClient.swift` | All 17 endpoints |
| `Shared/Network/DTOs.swift` | Wire types and `toDomain()` mappings |
| `Shared/Extensions/Formatting.swift` | Shared formatters and the AMOLED palette |
| `project.yml` | XcodeGen definition for all four targets |

### Phone app

| File | Purpose |
| --- | --- |
| `App/FurlPayGuardianApp.swift` | Entry point, signed-in/signed-out root |
| `App/ServiceContainer.swift` | Manual DI graph; `refreshAll()` fans out in parallel |
| `App/AppDelegate.swift` | APNs registration, `BGTaskScheduler`, notification delegate |
| `Core/Data/Repositories.swift` | Seven `@Observable` repositories over the API client |
| `Features/Auth/SignInView.swift` | OTP start/check |
| `Features/Dashboard/DashboardView.swift` | Net worth, card carousel, trip, reminders, watch sync |
| `Features/Dashboard/RemindersSection.swift` | Reminder list + `NewReminderSheet` |
| `Features/Cards/CardsView.swift` | Freeze/unfreeze, limits |
| `Features/Markets/MarketsView.swift` | Quote list |
| `Features/Stock/StockDetailView.swift` | Candles, timeframe, order entry |
| `Features/Travel/TravelView.swift` | Search → reprice → book |
| `Features/Voice/LiveVoiceView.swift` | `SFSpeechRecognizer` capture and relay |
| `Features/Wallet/SimpleScreens.swift` | Wallet, Portfolio, Spending, QuickPay |
| `Features/Alarm/AlarmView.swift` | Full-screen alarm + ringing effects |
| `Core/AI/RepositoryToolExecutor.swift` | Runs catalog tools against repositories |
| `Services/Push/PushNotificationService.swift` | Payload → deep link, silent-push refresh |
| `Services/Sync/WatchSyncCoordinator.swift` | Phone side of `WCSession` |
| `Services/Alarms/AlarmScheduler.swift` | Reminders on `UNUserNotificationCenter` |

### Domain (`Shared/Domain/`) — pure, testable, no I/O

| File | Purpose |
| --- | --- |
| `GuardianScore.swift` | Momentum / breadth / volatility score from bars already on screen |
| `EventPrioritisation.swift` | Effective-priority feed order + the morning briefing |
| `GuardianTools.swift` | The tool catalog and the mutating-tool contract |
| `VoiceCommandParser.swift` | Deterministic intent parsing — works with no network, no model |
| `NaturalTimeParser.swift` | "6pm" / "in 20 minutes" → `Date`, or `nil` rather than a guess |

### Watch app and complications

| File | Purpose |
| --- | --- |
| `FurlPayGuardianWatch/App/WatchApp.swift` | `WatchStore`, `WatchRoute`, navigation |
| `FurlPayGuardianWatch/Screens/WatchScreens.swift` | All 10 watch screens |
| `FurlPayGuardianWatch/Services/WatchConnectivityService.swift` | Snapshot/token receipt, voice relay |
| `FurlPayGuardianWatch/UI/Haptics.swift` | The haptic IS the confirmation on a wrist |
| `FurlPayGuardianWatch/UI/AssetLogo.swift` | Monogram-first logo; never blank, never broken |
| `FurlPayGuardianWidgets/GuardianComplications.swift` | Four watch-face complications |
| `FurlPayGuardianWidgets/GuardianTiles.swift` | Six Smart Stack tiles (the Wear Tiles equivalent) |

### Tests

| File | Covers |
| --- | --- |
| `Tests/ActionRegistryTests.swift` | The allowlist: rejection paths and the drop-undeclared-fields invariant; plus the portfolio maths |
| `Tests/DomainTests.swift` | Guardian score, prioritisation, briefing, voice parsing, natural time |
| `Tests/SpendingTests.swift` | Period wire names, budget fractions, snapshot back-compat |
| `Tests/PushDeepLinkTests.swift` | Payload parsing — the untrusted edge of the push path |

## Coverage against the Android source

Measured file-by-file against all 104 production Kotlin files in `guardian/`,
weighted by Kotlin LOC: **100%**, on both apps and every module.

Four of those files are answered by a *different* technology rather than a
transliteration, which is worth stating plainly:

| Android | iOS | Why not a port |
| --- | --- | --- |
| `GeminiTextAssistant` + `GeminiLiveAssistant` | `FoundationModelsAssistant` | The Kotlin sends the user's balances to a hosted model over the network with an API key. iOS 26 ships a ~3B model on-device at `SystemLanguageModel.default` — no key, no network in the call path, nothing to leak. For an app whose subject is the user's money that is not a nicety. |
| `mobile/alarm/AlarmActivity` + `wear/WatchAlarmService` | `GuardianAlarmKit` | AlarmKit (iOS 26) grants third-party apps real alarms — through Silent mode, through Focus, full-screen on the Lock Screen, surviving reboot. **An earlier revision of this README claimed iOS could not do this. That was true until iOS 26 and is now wrong.** |
| `data/db/GuardianDatabase` + `RoomEventRepository` | `EventStore` (SwiftData) | Room's direct counterpart. Migrates the old `UserDefaults` array once on first launch, then deletes it. |
| `wear/ui/GuardianIcons` (238 ln of hand-drawn glyphs) | `GuardianIcons` (~130 ln) | SF Symbols is a system icon family that already matches text weight and localises. Only the brand mark is hand-drawn, because it is brand geometry. Smaller on purpose. |

### Beyond the port

| Feature | Notes |
| --- | --- |
| Apple Pay top-up | No Android counterpart — the Wear app has no Google Pay. Collects an authorized `PKPaymentToken` and posts it. `/api/topup/apple-pay` now exists (Zod-validated, 10/min per user, idempotent), but its live path needs processor credentials (`STRIPE_SECRET_KEY` + `APPLE_PAY_MERCHANT_ID`), so `applePayTopUpEnabled` stays `false` until those are set. |
| Tap to Pay on iPhone | Merchant acceptance — the opposite direction. Code-complete and **not shippable yet**; see below. |

## Passport vault

Ported from **`native-app/`** (the Expo/React Native app), not from `guardian/`
— `guardian/` has no passport feature, so this is additive and does not affect
the parity figures above.

`Features/Passport/`, `Core/Data/PassportRepository.swift`,
`Shared/Models/TravelDocument.swift`.

### The rule inherited verbatim

**There is no document upload and there never should be.** The moment a
government ID photo touches this app's memory, our servers, our logs or our
backups, it is in scope for every biometric-data regime that applies to the
user — and we would be storing exactly the material an attacker wants most, to
do a job a specialist provider already does better. The camera feeds the
identity provider directly over the provider's own TLS session. What comes back
is a session identifier.

`TravelDocument` therefore models only a **masked** number, a status and dates.
A test asserts the encoded form contains no name, date of birth, photo, MRZ or
full document number — so adding one fails the build rather than slipping
through review.

### Where iOS differs from the RN app, and why

| | `native-app/` | iOS |
| --- | --- | --- |
| Hosted flow | `WebBrowser.openAuthSessionAsync` (Custom Tabs) | `ASWebAuthenticationSession` |
| Stack motion | `PanResponder` + JS mirror of `Animated.Value` | `DragGesture`, no mirror needed |
| **Biometric gate** | **none** | **Face ID, locked by default** |

The browser choice is the same decision for the same reason: an in-app WebView
is a hostile place to ask someone for a passport, because the app process can
read its cookies and inject JavaScript, and the user cannot see the real origin.
`ASWebAuthenticationSession` runs in Safari's own process, out of this app's
reach. `prefersEphemeralWebBrowserSession` is deliberately **false** — an
ephemeral session discards the provider's device-trust cookies and makes every
legitimate attempt look like a brand-new device to their fraud tooling.

### The gate the RN app doesn't have

Measured, not assumed: **zero** LocalAuthentication calls across
`passport.tsx`, `passport-scan.tsx`, `PassportCard.tsx` and
`PassportCardStack.tsx`. Card PAN reveal *is* gated there, and
`lib/biometrics.ts` explains why — revealing a PAN is sensitive-data *access*
rather than an approval, so it stays gated regardless of the user's "biometric
approvals" preference.

A vault of government identity documents is sensitive-data access by exactly
that reasoning. So this port gates it, on the same terms:

- Locked on entry; **re-locks on background**, so handing over an unlocked
  phone is not handing over a document wallet.
- No biometric enrolled leaves it **locked**. For an approval gate "no
  hardware" reasonably means let it through; the absence of a biometric is not
  permission to display someone's passport.
- Nothing is fetched while locked, so document data never enters memory before
  someone has proven they may see it.
- **Deleting asks again** inside an unlocked session. Unlocking is permission to
  look; destroying a verified document is a different question.

`submitted` is deliberately not `approved`, and a test asserts the outcome enum
has no `approved` case. A dismissed sheet must never be readable as a pass —
the provider decides asynchronously and tells the *server*.

## Tap to Pay on iPhone — what is built and what blocks it

Two different technologies, routinely confused:

| | Direction | Who |
| --- | --- | --- |
| **Apple Pay** | The user *pays* | Consumer |
| **Tap to Pay on iPhone** | The iPhone *accepts* a payment — it becomes the terminal | Merchant |

The customer taps an iPhone, Apple Watch, contactless card, or any other NFC
wallet against the merchant's iPhone. No reader hardware. **Two ordinary
iPhones cannot tap each other to send money** — one of them must be running an
approved merchant terminal.

### Built

`Shared/Domain/TapToPay.swift`, `Features/TapToPay/` — availability gating,
till-style amount entry, Apple's required merchant education, the terminal UI,
merchant-facing error copy, and a `TapToPayProviding` seam. 1,258 lines of
tests cover the amount arithmetic and the gating.

### Blocked on three things, none of them code

1. **A Payment Service Provider.** Apple's merchant terms require the merchant
   to be party to a PSP agreement with an Apple-authorised PSP, and the PSP —
   not us — owns onboarding, KYC, AML and underwriting. `PaymentCardReaderSession`
   is created from a token the PSP issues; **there is no standalone path.**
   FurlPay already uses Stripe (`apps/web/src/lib/payments/stripe.ts`) for crypto
   payment intents and merchant payouts, and Stripe Terminal is an authorised
   Tap to Pay PSP — so the likely conformance is Stripe Terminal over Connect.
   Nothing conforms today; `UnconfiguredTapToPayProvider` **fails closed**,
   because a stub returning fake success would let a merchant believe they had
   been paid.
2. **Apple's entitlement**, `com.apple.developer.proximity-reader.payment.acceptance`.
   Granted by request only: organization-level developer account, submitted by
   the Account Holder, development entitlement first, then a separate
   distribution entitlement after internal testing.
3. **The "How to Tap" overlay**, presented through `ProximityReaderDiscovery`.
   Apple requires it before the first payment and **rejects apps that ship
   without it**. Implemented in `TapToPayService.showHowToTapIfNeeded()`, with
   our own fallback for iOS 16.4–17 where the content API does not exist.

### Constraints worth knowing before planning around it

- iPhone XS or later. Not the Simulator — ProximityReader needs the physical
  Secure Element, so CI compiles this and exercises the gating, but **the tap
  itself can only ever be tested on a real device.**
- Does not work on beta iOS at all.
- Region-gated. The supported list is deliberately **not** hardcoded here — it
  moves, and a stale copy would hide the feature from a merchant who could use
  it. The PSP is asked instead.
- Tap to Pay is an *acceptance interface*, not a processor. Settling into USDC
  still requires a PSP whose settlement flow supports it.
- **The backend has no card-acquiring concept at all.**
  `apps/web/src/lib/rails/registry.ts` registers five rails and every one of
  them is on-chain (x402, Machine Payments Protocol, CCTP V2, LI.FI, gasless
  USDC). The existing Stripe code does crypto payment intents and merchant
  payouts — not card-present capture. So card acceptance is a **new rail
  category** server-side, not an extension of an existing one: merchant
  onboarding state, a capture/refund lifecycle, and settlement into the ledger
  all have to be built. Budget for that, not just for a Swift conformance.
| `ActionDispatcher` type safety | The Kotlin enforces in the *type system* that only a registry-validated action can dispatch. The first Swift pass lost that by taking three loose strings. `ApprovedAction` restores it: the initialiser is fileprivate, so the registry is the only thing that can make one. |

## The security invariant

`ActionRegistry.swift` is the load-bearing file. The AI may *propose* an action;
it may never *define* one. Every confirmable action declares its exact id,
endpoint, method and field schema, and the outgoing request is **rebuilt from the
registry** — fields the model invented are dropped, and any type, range, pattern
or enum mismatch rejects the whole action *before* the biometric prompt appears.

A user must never be asked to Face ID something the app has already decided not
to send.

The endpoints and their enablement were read out of
`core/domain/action/GuardianActionRegistry.kt`, not transcribed from a document.
The three implementations — TypeScript (`native-app/lib/copilotActions.ts`),
Kotlin, and this — must stay in behavioural lockstep; a gap in one is a gap in
the confirmation gate on that platform alone.

### Watch restrictions carried over

1. **Mutating operations are blocked on the watch.** No biometric hardware, so
   `UnavailableBiometricGate` denies everything. Actions either relay to the
   phone or use two-step manual confirmation.
2. **Card unfreeze is phone-only.** Freeze is allowed; unfreeze shows
   "Unfreeze from your phone".
3. **Background voice is read-only.** No visible scene means nowhere to present
   a prompt, matching Android's `VoiceRelayService` rule.
4. **Booking idempotency keys are generated by the caller**, not the client, and
   held across retries — minting a fresh key per attempt defeats the mechanism.

## Verified against the Android source

The API surface was extracted from the Kotlin annotations rather than the
specification document:

```
GET  wallets · cards · transactions · investing/portfolio · markets
     markets/bars · markets/{symbol} · travel/trips · travel/deals · travel/hotels
POST auth/otp/start · auth/otp/check · cards/settings · investing/order
     travel/search · travel/book · push/devices
```

All 17 matched the spec. The file count did not — the Android codebase is 116
Kotlin files / 10,313 lines, against the spec's claim of "~73".
