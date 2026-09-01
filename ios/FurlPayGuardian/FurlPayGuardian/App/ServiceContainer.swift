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
        sync.activate(container: self)
        push.attach(container: self)
        // Keeps in-app state in step with an alarm acknowledged on the Lock
        // Screen, where the app never runs.
        alarmKitObserver.observe(self)
        if isSignedIn { await refreshAll() }
    }

    /// Loads every snapshot in parallel. Sequential awaits here would make a
    /// cold dashboard cost the sum of six round trips instead of the slowest one.
    public func refreshAll() async {
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
        await sync.pushToken(token)
        await refreshAll()
    }

    public func signOut() async {
        await tokenStore.clear()
        isSignedIn = false
        wallets.clear(); cards.clear(); transactions.clear()
        portfolio.clear(); markets.clear(); travel.clear()
        passport.clear()
        swaps.clear(); earn.clear(); bills.clear()
        offRamp.clear(); credit.clear(); banking.clear()
        // The model transcript holds balances and card digits. Clearing the
        // repositories but leaving it would mean the next user could ask the
        // assistant what the last one's balance was.
        assistant.reset()
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
