//
//  Repositories.swift
//
//  Ports of guardian/core/data. Each repository owns one slice of cached state,
//  is `@MainActor @Observable` so SwiftUI tracks it directly, and exposes the
//  last successful value plus the last error.
//
//  Cache-then-refresh throughout: a view renders whatever was last known
//  immediately and updates when the network answers. A financial app that shows
//  a spinner where a balance was two seconds ago reads as broken.
//

import Foundation

/// Shared loading/error handling, so seven repositories do not each reimplement
/// it slightly differently.
@MainActor
@Observable
public class BaseRepository {
    public internal(set) var isLoading = false
    public internal(set) var lastError: String?
    public internal(set) var lastUpdated: Date?

    /// Runs `work`, keeping the previous value on failure. Returns nil on error
    /// so callers can decide whether to overwrite.
    func load<T>(_ work: () async throws -> T) async -> T? {
        isLoading = true
        defer { isLoading = false }
        do {
            let value = try await work()
            lastError = nil
            lastUpdated = Date()
            return value
        } catch APIError.cancelled {
            return nil                       // a superseded refresh is not an error
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }
}

// MARK: - Wallets

@MainActor
@Observable
public final class WalletRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var overview: WalletOverview?

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchWallets() }) { overview = value }
    }

    public func clear() { overview = nil; lastUpdated = nil }

    public var totalUsd: Decimal { overview?.totalUsd ?? 0 }
}

// MARK: - Cards

@MainActor
@Observable
public final class CardRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var cards: [Card] = []

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchCards() }) { cards = value }
    }

    public func clear() { cards = []; lastUpdated = nil }

    /// Mutating. The caller MUST have a successful `BiometricGate` result — the
    /// gate is not called here so that a single UI flow owns both the prompt and
    /// its cancellation, rather than a prompt appearing from inside a data layer.
    public func setFrozen(cardId: String, frozen: Bool) async throws {
        let updated = try await api.updateCardSettings(cardId: cardId, frozen: frozen)
        if let index = cards.firstIndex(where: { $0.id == cardId }) {
            cards[index] = updated
        } else {
            await refresh()
        }
    }
}

// MARK: - Transactions

@MainActor
@Observable
public final class TransactionRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var transactions: [Transaction] = []

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchTransactions() }) {
            transactions = value.sorted { $0.at > $1.at }
        }
    }

    public func clear() { transactions = []; lastUpdated = nil }

    /// Day/Week/Month debit totals.
    ///
    /// Computed from calendar boundaries, not rolling 24h/7d windows: a user
    /// asking what they spent "today" means since midnight, and a rolling window
    /// would silently include half of yesterday evening.
    /// "How much did I spend?" — computed HERE from the ledger, not asked of a
    /// model. The API has no summary endpoint, so the voice answer, the tile and
    /// the Spending screen all read this one function and cannot disagree.
    ///
    /// Only outgoing, non-failed transactions count as spending.
    public var spendingSummary: SpendingSummary {
        // ISO week, Monday start — matching ComputeSpendingSummaryUseCase.kt.
        // `Calendar.current` starts the week on Sunday in en_US, which would put
        // Sunday's spending in a different week on each platform.
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current

        let now = Date()
        let startOfDay = calendar.startOfDay(for: now)
        let startOfWeek = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? startOfDay
        let startOfMonth = calendar.dateInterval(of: .month, for: now)?.start ?? startOfDay

        func spent(since date: Date) -> [Transaction] {
            transactions.filter {
                $0.direction == .debit && $0.status != .failed
                    && $0.at >= date && $0.at <= now
            }
        }

        func window(since date: Date) -> SpendingWindow {
            let txs = spent(since: date)
            let byCategory = Dictionary(
                grouping: txs.compactMap { tx in tx.category.map { ($0, tx.amountUsd) } },
                by: \.0
            ).mapValues { $0.reduce(Decimal.zero) { $0 + $1.1 } }

            return SpendingWindow(
                totalUsd: txs.reduce(Decimal.zero) { $0 + $1.amountUsd },
                transactionCount: txs.count,
                // Ties broken by category name so the answer is stable between
                // two refreshes that saw the same ledger.
                topCategory: byCategory
                    .max { a, b in (a.value, b.key) < (b.value, a.key) }?.key,
                budgetUsd: budgets[periodKey(for: date, day: startOfDay, week: startOfWeek)]
            )
        }

        let dayWindow = window(since: startOfDay)
        let weekWindow = window(since: startOfWeek)
        let monthWindow = window(since: startOfMonth)

        return SpendingSummary(
            day: dayWindow.totalUsd,
            week: weekWindow.totalUsd,
            month: monthWindow.totalUsd,
            asOf: now,
            windows: [
                SpendingPeriod.today.wireName: dayWindow,
                SpendingPeriod.thisWeek.wireName: weekWindow,
                SpendingPeriod.thisMonth.wireName: monthWindow,
            ]
        )
    }

    /// User-set budgets, keyed by `SpendingPeriod.wireName`. A phone-side
    /// preference joined in here rather than fetched — the API has no budget
    /// endpoint.
    public var budgets: [String: Decimal] {
        get { GuardianPreferences.shared.budgets }
        set { GuardianPreferences.shared.budgets = newValue }
    }

    private func periodKey(for start: Date, day: Date, week: Date) -> String {
        if start == day { return SpendingPeriod.today.wireName }
        if start == week { return SpendingPeriod.thisWeek.wireName }
        return SpendingPeriod.thisMonth.wireName
    }
}

// MARK: - Portfolio

@MainActor
@Observable
public final class PortfolioRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var summary: PortfolioSummary?

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchPortfolio() }) { summary = value }
    }

    public func clear() { summary = nil; lastUpdated = nil }

    /// Mutating — biometric-gated by the caller.
    public func placeOrder(symbol: String, side: String, notionalUsd: Decimal) async throws -> OrderResponse {
        let result = try await api.placeOrder(symbol: symbol, side: side, notionalUsd: notionalUsd)
        await refresh()
        return result
    }
}

// MARK: - Markets

@MainActor
@Observable
public final class MarketRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var quotes: [MarketQuote] = []
    /// Bars are cached per symbol+timeframe; switching timeframes on the stock
    /// screen should not refetch what was already loaded.
    private var barsCache: [String: [Candle]] = [:]

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchMarkets(kind: "crypto", limit: 20) }) {
            quotes = value
        }
    }

    public func clear() { quotes = []; barsCache = [:]; lastUpdated = nil }

    public func bars(symbol: String, timeframe: String) async -> [Candle] {
        let key = "\(symbol)|\(timeframe)"
        if let cached = barsCache[key] { return cached }
        guard let value = await load({ try await api.fetchBars(symbol: symbol, timeframe: timeframe) })
        else { return [] }
        barsCache[key] = value
        return value
    }

    public func detail(symbol: String) async -> AssetDetail? {
        await load { try await api.fetchAssetDetail(symbol: symbol) }
    }

    /// Largest absolute move first — "biggest movers" means the largest change
    /// in either direction, so sorting by signed value would list only gainers.
    public var biggestMovers: [MarketQuote] {
        quotes
            .filter { $0.changePercent24h != nil }
            .sorted { abs($0.changePercent24h ?? 0) > abs($1.changePercent24h ?? 0) }
    }
}

// MARK: - Travel

@MainActor
@Observable
public final class TravelRepository: BaseRepository {
    private let api: FurlPayAPIClient
    public private(set) var trips: [TravelBooking] = []
    public private(set) var deals: [TravelDeal] = []
    public private(set) var boardingPasses: [BoardingPass] = []

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        async let tripsResult = load { try await api.fetchTrips() }
        async let dealsResult = load { try await api.fetchDeals() }
        async let passesResult = load { try await api.fetchBoardingPasses() }
        if let value = await tripsResult { trips = value }
        if let value = await dealsResult { deals = value }
        if let value = await passesResult { boardingPasses = value }
    }

    public func clear() { trips = []; deals = []; boardingPasses = []; lastUpdated = nil }

    /// The pass to put in front of the traveller: the next flight that has not
    /// landed. Sorted by departure so a same-day connection does not outrank
    /// the leg being flown right now.
    public func activePass(at now: Date = .now) -> BoardingPass? {
        boardingPasses
            .filter { $0.status(at: now) != .landed }
            .min { $0.departsAt < $1.departsAt }
    }

    public var activeTrips: [TravelBooking] {
        trips.filter(\.isActive).sorted { $0.startDate < $1.startDate }
    }

    /// Mutating, and the one call that can double-charge.
    ///
    /// The key is generated ONCE per user intent and passed in, so a retry after
    /// a timeout reuses it. Generating it inside this method would mint a new key
    /// per attempt and defeat the whole mechanism.
    public func book(offerId: String, idempotencyKey: String) async throws -> TravelBooking {
        let booking = try await api.book(offerId: offerId, idempotencyKey: idempotencyKey)
        await refresh()
        return booking
    }
}

// MARK: - Events

/// Reminders and alarms. Local-only for now — the Android app backs these with
/// Room, and SwiftData is the intended replacement; this keeps the same public
/// surface so swapping the store does not touch any view.
@MainActor
@Observable
public final class EventRepository {
    /// Mirrors the store so views can observe it. SwiftData's own `@Query` is
    /// not used here because these events are read from three non-View places
    /// too — the tool executor, the sync coordinator and the alarm scheduler.
    public private(set) var events: [GuardianEvent] = []

    private let store: EventStore

    public init(store: EventStore = .shared) {
        self.store = store
        store.migrateLegacyStoreIfNeeded()
        events = store.all()
    }

    public var active: [GuardianEvent] {
        events.filter { !$0.acknowledged }.sorted { $0.startAt < $1.startAt }
    }

    public var next: GuardianEvent? { active.first { $0.startAt > Date() } }

    public func add(_ event: GuardianEvent) {
        store.upsert([event])
        events = store.all()
    }

    /// Bulk upsert for a sync. One transaction rather than N — the reason the
    /// store exists.
    public func upsert(_ incoming: [GuardianEvent]) {
        guard !incoming.isEmpty else { return }
        store.upsert(incoming)
        events = store.all()
    }

    public func acknowledge(_ id: String) {
        store.acknowledge(id)
        events = store.all()
    }

    public func remove(_ id: String) {
        store.remove(id)
        events = store.all()
    }

    /// Drops long-acknowledged events. Called from `refreshAll`.
    public func prune() {
        store.prune()
        events = store.all()
    }
}
