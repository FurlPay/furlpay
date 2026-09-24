//
//  ServiceContainer.swift
//
//  Manual dependency injection. No Swinject: the graph is a dozen objects with
//  no cycles, and a runtime-resolving container would trade compile-time safety
//  for a framework that solves a problem this app does not have.
//

import Foundation
import SwiftUI

@MainActor
@Observable
public final class ServiceContainer {
    public let api: FurlPayAPIClient
    public let tokenStore: KeychainTokenStore
    public let biometrics: any BiometricGating

    public let wallets: WalletRepository
    public let cards: CardRepository
    public let transactions: TransactionRepository
    public let portfolio: PortfolioRepository
    public let markets: MarketRepository
    public let travel: TravelRepository
    public let events: EventRepository
    public let passport: PassportRepository
    public let swaps: SwapRepository
    public let earn: EarnRepository
    public let bills: BillsRepository
    public let offRamp: OffRampRepository
    public let credit: CreditRepository
    public let banking: BankingRepository
    public let passkeys: PasskeyService

    public let sync: WatchSyncCoordinator
    public let alarms: AlarmScheduler
    public let push: PushNotificationService
    public let alarmPresenter: AlarmPresenter
    public let preferences: GuardianPreferences
    let alarmKitObserver = GuardianAlarmKitScheduler()

    /// The on-device model. Fallback only — see FoundationModelsAssistant.
    ///
    /// @ObservationIgnored is required, not decorative. @Observable rewrites
    /// every stored property into a computed one backed by the observation
    /// registrar, and `lazy` cannot be applied to a computed property — so
    /// without this the macro expansion fails with "'lazy' cannot be used on a
    /// computed property" and "init accessor cannot refer to property
    /// '_assistant'". It is also correct on the merits: these are services, not
    /// state a view should redraw on.
    @ObservationIgnored
    public private(set) lazy var assistant = FoundationModelsAssistant(container: self)

    /// Built lazily because it holds a reference back to this container —
    /// constructing it in `init` would mean passing `self` before it exists.
    @ObservationIgnored
    public private(set) lazy var tools: RepositoryToolExecutor = {
        // confirmMutating: is spelled out rather than passed as a trailing
        // closure. RepositoryToolExecutor's init takes TWO function-typed
        // parameters — `now: () -> Date` and `confirmMutating:` — so an
        // unlabelled trailing closure binds to the wrong one, and the compiler
        // reports it as "cannot convert '(_) async -> Date' to '() -> Date'"
        // and "cannot infer type of closure parameter 'invocation'", neither of
        // which points at the actual problem.
        RepositoryToolExecutor(container: self, confirmMutating: { [weak self] invocation in
            guard let self else { return false }
            // `.unavailable` counts as a refusal, not a pass. A device with no
            // enrolled biometrics must not become the easy path to a mutating
            // tool — that is the whole reason the watch gate denies everything.
            return await self.biometrics.authenticate(
                reason: "Confirm: \(invocation.tool.description)"
            ).isAuthenticated
        })
    }()

    /// Drives the root view. Set once at launch from the keychain, then only by
    /// sign-in and sign-out.
    public var isSignedIn: Bool = false

    /// A token in the keychain proves a session exists; it does not prove the
    /// person currently holding the phone is its owner. The root view keeps
    /// account data behind this gate whenever an existing session is restored
    /// or the app has been away long enough to be handed to someone else.
    public var isSessionLocked: Bool = false

    /// Why the session ended, when it ended on its own rather than by request.
    ///
    /// Set by `sessionExpired()` and cleared on the next sign-in. Without it a
    /// forced sign-out drops the user on the sign-in screen with no explanation,
    /// which reads as the app having lost their account.
    public var sessionEndedReason: String?

    public init(
        api: FurlPayAPIClient = .shared,
        tokenStore: KeychainTokenStore = .shared,
        biometrics: (any BiometricGating)? = nil
    ) {
        self.api = api
        self.tokenStore = tokenStore
        #if os(watchOS)
        // No biometric hardware on the wrist — see BiometricGate.swift.
        self.biometrics = biometrics ?? UnavailableBiometricGate()
        #else
        self.biometrics = biometrics ?? BiometricGate()
        #endif

        wallets = WalletRepository(api: api)
        cards = CardRepository(api: api)
        transactions = TransactionRepository(api: api)
        portfolio = PortfolioRepository(api: api)
        markets = MarketRepository(api: api)
        travel = TravelRepository(api: api)
        events = EventRepository()
        passport = PassportRepository(api: api, biometrics: self.biometrics)
        swaps = SwapRepository(api: api)
        earn = EarnRepository(api: api)
        bills = BillsRepository(api: api)
        offRamp = OffRampRepository(api: api)
        credit = CreditRepository(api: api)
        banking = BankingRepository(api: api)
        passkeys = PasskeyService(api: api)

        alarms = AlarmScheduler()
        sync = WatchSyncCoordinator()
        push = PushNotificationService()
        alarmPresenter = AlarmPresenter()
        preferences = GuardianPreferences.shared

        // Any 401 anywhere tears the session down through ONE path. Registered
        // after every stored property is initialised — the closure captures
        // `self`, which is not available until `init` completes its stores.
        //
        // `[weak self]` because the client is a long-lived singleton by default
        // (`FurlPayAPIClient.shared`): a strong capture would keep a replaced
        // container alive for the process lifetime.
        Task { [weak self] in
            await api.setUnauthorizedHandler { [weak self] in
                await self?.sessionExpired()
            }
        }
    }

    /// The full security order for an AI-proposed action, in one place so no
    /// call site can perform the steps out of sequence:
    ///
    ///   1. Resolve against the registry. Rejects BEFORE any prompt — a user
    ///      must never be asked to Face ID something already destined to fail.
    ///   2. Biometric gate.
    ///   3. Dispatch, which only accepts the registry's own copy.
    ///
    /// Returns the rejection reason, or nil on success. The server's response
    /// is discarded — use `confirmAndDispatchReturning` when the caller has to
    /// report what the request actually did.
    public func confirmAndDispatch(_ confirmation: Confirmation) async -> String? {
        if case .rejected(let reason) = await confirmAndDispatchReturning(confirmation) {
            return reason
        }
        return nil
    }

    /// What a dispatch actually produced.
    ///
    /// `confirmAndDispatch` above collapses this to "nil means it worked",
    /// which is right for a fire-and-forget approval but wrong for anything
    /// that has to report an outcome: the server's response was thrown away,
    /// so a caller could only ASSUME what the request did. SendView assumed a
    /// two-phase payment route had settled a payment when it had only quoted
    /// one, and told the user "Sent". A screen that reports an outcome must
    /// read one.
    public enum DispatchOutcome: Sendable {
        case rejected(reason: String)
        case dispatched(response: JSONValue)
    }

    /// The full security order for an AI-proposed action, returning the
    /// server's own response. See `confirmAndDispatch` for the step list — this
    /// is that method; the other one discards the payload.
    public func confirmAndDispatchReturning(
        _ confirmation: Confirmation
    ) async -> DispatchOutcome {
        let resolved = GuardianActionRegistry.resolve(confirmation)
        guard let action = resolved.approved else {
            if case .rejected(let reason) = resolved { return .rejected(reason: reason) }
            return .rejected(reason: "That action could not be validated.")
        }

        // Built from the VALIDATED body, never from the payload's own
        // `amountUsd`. The figure the user reads above Face ID is by
        // construction the figure that will be sent.
        let prompt = action.amountUsd.map {
            "Confirm \(GuardianActionRegistry.formatUsd($0)) — \(action.title)"
        } ?? "Confirm \(action.title)"

        // Honours the Settings toggle. The RN app had a bug worth not
        // repeating: the preference was written to the profile but every screen
        // called LocalAuthentication directly, so flipping it changed nothing.
        // This is the ONE gate for approvals, so reading it here is what makes
        // the toggle real.
        //
        // Sensitive-data ACCESS does not come through here — the document
        // wallet and bank details call `biometrics` directly and stay gated
        // whatever this is set to.
        //
        // The toggle CANNOT clear an action that moves money. `amountUsd` is
        // non-nil exactly when the registry validated a USD-denominated field,
        // so this covers every payment, swap, order, DCA and deposit — up to
        // the $25,000 ceiling. A convenience preference is allowed to make
        // freezing a card one tap; it is not allowed to make a five-figure
        // transfer one tap.
        if preferences.biometricApprovals || action.amountUsd != nil {
            guard await biometrics.authenticate(reason: prompt).isAuthenticated else {
                return .rejected(reason: "Not confirmed.")
            }
        }

        do {
            let response = try await GuardianActionDispatcher(api: api).dispatch(action)
            await refreshAll()
            return .dispatched(response: response)
        } catch {
            return .rejected(reason: "That action could not be completed.")
        }
    }

    /// Today's briefing. Computed from events on demand rather than stored —
    /// the counts must reflect the feed as it is now, not as it was at 7am.
    public func briefing(summary: String = "") -> DailyBriefing {
        GenerateBriefing()(events: events.events, summary: summary)
    }

    /// The feed order every surface uses. Repositories deliberately do NOT
    /// apply this themselves — `events.active` is raw storage order, and
    /// prioritisation is a domain decision, not a persistence one.
    public var prioritisedEvents: [GuardianEvent] {
        PrioritizeEvents()(events.active)
    }

    public func bootstrap() async {
        isSignedIn = await tokenStore.get() != nil
        // A restored bearer session must never bypass Face ID just because the
        // Keychain could read it after the device was unlocked.
        isSessionLocked = isSignedIn
        sync.activate(container: self)
        push.attach(container: self)
        // Keeps in-app state in step with an alarm acknowledged on the Lock
        // Screen, where the app never runs.
        alarmKitObserver.observe(self)
        // Do not fetch a restored account until the holder proves local
        // presence. Otherwise a background launch can refresh balances and
        // card state while the session-lock screen is still protecting it.
    }

    /// Loads every snapshot in parallel. Sequential awaits here would make a
    /// cold dashboard cost the sum of six round trips instead of the slowest one.
    public func refreshAll() async {
        // Push/background tasks may wake the process while a restored session
        // is intentionally locked. Account refresh is not an authorization
        // bypass: defer it until unlockSession() establishes local presence.
        guard isSignedIn, !isSessionLocked else { return }
        async let w: Void = wallets.refresh()
        async let c: Void = cards.refresh()
        async let t: Void = transactions.refresh()
        async let p: Void = portfolio.refresh()
        async let m: Void = markets.refresh()
        async let v: Void = travel.refresh()
        _ = await (w, c, t, p, m, v)
        events.prune()          // unbounded local history is the store's failure mode
        await sync.pushAllSnapshots(from: self)
    }

    public func signIn(token: String) async throws {
        try await tokenStore.save(token)
        isSignedIn = true
        // Completing the OTP/passkey ceremony is fresh account authentication.
        isSessionLocked = false
        // The expiry notice belongs to the session that ended, not this one.
        sessionEndedReason = nil
        await sync.pushToken(token)
        await refreshAll()
    }

    public func signOut() async {
        await tokenStore.clear()
        isSignedIn = false
        isSessionLocked = false
        wallets.clear(); cards.clear(); transactions.clear()
        portfolio.clear(); markets.clear(); travel.clear()
        passport.clear()
        swaps.clear(); earn.clear(); bills.clear()
        offRamp.clear(); credit.clear(); banking.clear()
        // The model transcript holds balances and card digits. Clearing the
        // repositories but leaving it would mean the next user could ask the
        // assistant what the last one's balance was.
        assistant.reset()

        // The paired watch holds the SAME session token — `signIn` pushes it —
        // and calls the API directly when the phone is unreachable. Without
        // this the watch kept a valid bearer token until the JWT's own expiry,
        // so signing out here revoked nothing on the wrist.
        await sync.clearToken()

        // The App Group snapshot feeds the phone's own widgets, which never
        // make a network call. Left behind, the previous account's balance
        // stays on the home screen after sign-out.
        SnapshotCache.clear()
    }

    /// Forced sign-out after the server rejected the session (401).
    ///
    /// The API client used to handle a 401 by clearing the keychain and nothing
    /// else — `isSignedIn` stayed true, every repository kept its data, the
    /// assistant kept its transcript, and the watch kept its token. The UI went
    /// on showing the previous session's balances until the user happened to
    /// sign out by hand or relaunch.
    ///
    /// Both the React Native and Android clients route a 401 through their full
    /// teardown; this is the iOS half of that contract. Separate from
    /// `signOut()` only so the reason can be surfaced — the teardown is
    /// deliberately identical, because a session the server has rejected is as
    /// over as one the user ended.
    public func sessionExpired() async {
        await signOut()
        sessionEndedReason = "Your session expired. Sign in to continue."
    }

    /// Re-arm the privacy gate without destroying the session. This is safe to
    /// call repeatedly from lifecycle callbacks and intentionally does nothing
    /// for a signed-out app.
    public func lockSession() {
        if isSignedIn { isSessionLocked = true }
    }

    /// Unlocks an existing session with a fresh local user-presence check.
    /// `.unavailable` and `.denied` both leave the session locked: a missing
    /// biometric factor must never become the easier path into financial data.
    public func unlockSession() async -> BiometricResult {
        guard isSignedIn else { return .denied(reason: "No active session.") }
        let result = await biometrics.authenticate(reason: "Unlock FurlPay")
        if result.isAuthenticated {
            isSessionLocked = false
            await refreshAll()
        }
        return result
    }

    /// Current snapshot for the watch and the complication.
    public func snapshot() -> GuardianSnapshot {
        GuardianSnapshot(
            wallets: wallets.overview,
            cards: cards.cards,
            events: events.active,
            trips: travel.trips,
            portfolio: portfolio.summary,
            spending: transactions.spendingSummary,
            markets: markets.quotes
        )
    }
}
