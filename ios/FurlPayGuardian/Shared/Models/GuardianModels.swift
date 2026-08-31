//
//  GuardianModels.swift
//  Shared between the iPhone app, the Watch app and the widget extension.
//
//  Ported from guardian/core/domain (Kotlin). Field names match the Kotlin
//  domain types so the same JSON from https://furlpay.com/api decodes on both
//  platforms without a server change.
//
//  Everything here is `Sendable`: Swift 6 strict concurrency is on, these
//  values cross actor boundaries constantly (network actor -> @MainActor view
//  model -> WatchConnectivity), and a non-Sendable model would produce a
//  compiler error at every one of those hops.
//

import Foundation

// MARK: - Wallet

public struct Wallet: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let currency: String
    public let balance: Decimal
    public let usdValue: Decimal
    public let chain: String?

    public init(id: String, currency: String, balance: Decimal, usdValue: Decimal, chain: String?) {
        self.id = id
        self.currency = currency
        self.balance = balance
        self.usdValue = usdValue
        self.chain = chain
    }
}

public struct WalletOverview: Codable, Sendable, Hashable {
    public let totalUsd: Decimal
    public let wallets: [Wallet]
    /// The Safe smart-account address — the thing a payer actually scans.
    ///
    /// Optional because it rides the watch snapshot, and a snapshot written by
    /// an older build will not carry it. A QuickPay screen with no address
    /// says so rather than encoding a placeholder.
    public let safeAddress: String?

    public init(totalUsd: Decimal, wallets: [Wallet], safeAddress: String? = nil) {
        self.totalUsd = totalUsd
        self.wallets = wallets
        self.safeAddress = safeAddress
    }

    /// Largest balance first — the ordering the Wear OS wallet screen uses, and
    /// the only ordering that makes sense on a 41mm display where the user sees
    /// two rows without scrolling.
    public var sortedByValue: [Wallet] {
        wallets.sorted { $0.usdValue > $1.usdValue }
    }
}

// MARK: - Card

public enum CardKind: String, Codable, Sendable { case physical, virtual, unknown }
public enum CardNetwork: String, Codable, Sendable { case visa, mastercard, unknown }

public struct CardLimits: Codable, Sendable, Hashable {
    public let dailySpend: Decimal?
    public let monthlySpend: Decimal?
}

public struct Card: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let last4: String
    public let kind: CardKind
    public let network: CardNetwork
    public var frozen: Bool
    public let label: String
    public let limits: CardLimits?

    public init(
        id: String, last4: String, kind: CardKind, network: CardNetwork,
        frozen: Bool, label: String, limits: CardLimits?
    ) {
        self.id = id
        self.last4 = last4
        self.kind = kind
        self.network = network
        self.frozen = frozen
        self.label = label
        self.limits = limits
    }

    /// Unknown kinds/networks decode to `.unknown` rather than throwing, so a
    /// server that adds "amex" tomorrow does not blank the user's card list on
    /// an app version shipped today.
    private enum CodingKeys: String, CodingKey {
        case id, last4, kind, network, frozen, label, limits
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        last4 = try c.decodeIfPresent(String.self, forKey: .last4) ?? "••••"
        kind = (try? c.decode(CardKind.self, forKey: .kind)) ?? .unknown
        network = (try? c.decode(CardNetwork.self, forKey: .network)) ?? .unknown
        frozen = try c.decodeIfPresent(Bool.self, forKey: .frozen) ?? false
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? "Card"
        limits = try c.decodeIfPresent(CardLimits.self, forKey: .limits)
    }
}

// MARK: - Transaction

public enum TransactionDirection: String, Codable, Sendable { case credit, debit }
public enum TransactionStatus: String, Codable, Sendable {
    case pending, settled, failed, reversed, unknown
}

public struct Transaction: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let at: Date
    public let description: String
    public let amountUsd: Decimal
    public let direction: TransactionDirection
    public let status: TransactionStatus
    public let category: String?
}

/// Spending window the `getSpending` voice tool accepts. `wireName` is the
/// exact string the API and the tool schema use — keep them in lockstep.
public enum SpendingPeriod: String, Codable, Sendable, CaseIterable {
    case today, thisWeek, thisMonth

    public var wireName: String {
        switch self {
        case .today:     "today"
        case .thisWeek:  "this_week"
        case .thisMonth: "this_month"
        }
    }

    public var spokenLabel: String {
        switch self {
        case .today:     "today"
        case .thisWeek:  "this week"
        case .thisMonth: "this month"
        }
    }

    public init?(wireName: String) {
        guard let match = Self.allCases.first(where: { $0.wireName == wireName }) else { return nil }
        self = match
    }
}

/// One period's worth of spending — the shape the voice tool and the tile both
/// answer from, so they can never disagree.
public struct SpendingWindow: Codable, Sendable, Hashable {
    public let totalUsd: Decimal
    public let transactionCount: Int
    public let topCategory: String?
    /// Budget for the period if the user set one; nil = no budget.
    public let budgetUsd: Decimal?

    public init(
        totalUsd: Decimal, transactionCount: Int,
        topCategory: String? = nil, budgetUsd: Decimal? = nil
    ) {
        self.totalUsd = totalUsd
        self.transactionCount = transactionCount
        self.topCategory = topCategory
        self.budgetUsd = budgetUsd
    }

    /// 0...1+ fraction of budget consumed; nil when no budget is set.
    public var budgetUsedFraction: Double? {
        guard let budgetUsd, budgetUsd > 0 else { return nil }
        return NSDecimalNumber(decimal: totalUsd / budgetUsd).doubleValue
    }

    public static let empty = SpendingWindow(totalUsd: 0, transactionCount: 0)
}

/// Day/Week/Month rollups. Computed on the phone and pushed to the watch as a
/// snapshot: the watch must be able to render Spending with no network at all.
public struct SpendingSummary: Codable, Sendable, Hashable {
    public let day: Decimal
    public let week: Decimal
    public let month: Decimal
    public let asOf: Date

    /// Per-window detail. Optional so a snapshot written by an older build
    /// still decodes — the watch and the phone update independently, and a
    /// decode failure here would blank the Spending screen entirely.
    public let windows: [String: SpendingWindow]?

    public init(
        day: Decimal, week: Decimal, month: Decimal, asOf: Date,
        windows: [String: SpendingWindow]? = nil
    ) {
        self.day = day
        self.week = week
        self.month = month
        self.asOf = asOf
        self.windows = windows
    }

    public static let empty = SpendingSummary(day: 0, week: 0, month: 0, asOf: .distantPast)

    /// Detail for a period, falling back to the bare total when a snapshot
    /// predates `windows`.
    public func window(_ period: SpendingPeriod) -> SpendingWindow {
        if let window = windows?[period.wireName] { return window }
        let total: Decimal = {
            switch period {
            case .today:     day
            case .thisWeek:  week
            case .thisMonth: month
            }
        }()
        return SpendingWindow(totalUsd: total, transactionCount: 0)
    }
}

// MARK: - Guardian events (reminders and alarms)

public enum EventSource: String, Codable, Sendable { case user, system, ai }

public enum EventPriority: String, Codable, Sendable, CaseIterable {
    case low, medium, high, critical

    /// Stored as an Int in SwiftData so `#Predicate` can compare it directly.
    public var rank: Int {
        switch self {
        case .low: 0
        case .medium: 1
        case .high: 2
        case .critical: 3
        }
    }

    public init(rank: Int) {
        self = switch rank {
        case 3: .critical
        case 2: .high
        case 1: .medium
        default: .low
        }
    }
}

public enum ReminderIntensity: String, Codable, Sendable { case gentle, firm, urgent, max }

public struct ReminderStage: Codable, Sendable, Hashable {
    public let offset: TimeInterval
    public let intensity: ReminderIntensity
    public let bypassDnd: Bool
}

public struct GuardianEvent: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let source: EventSource
    public let title: String
    public let detail: String?
    public let startAt: Date
    public let priority: EventPriority
    public let actionUrl: String?
    public var acknowledged: Bool

    public init(
        id: String = UUID().uuidString,
        source: EventSource,
        title: String,
        detail: String? = nil,
        startAt: Date,
        priority: EventPriority = .medium,
        actionUrl: String? = nil,
        acknowledged: Bool = false
    ) {
        self.id = id
        self.source = source
        self.title = title
        self.detail = detail
        self.startAt = startAt
        self.priority = priority
        self.actionUrl = actionUrl
        self.acknowledged = acknowledged
    }

    public var isActive: Bool { !acknowledged && startAt > .distantPast }
}

// MARK: - Markets

public struct MarketQuote: Identifiable, Codable, Sendable, Hashable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let price: Decimal?
    public let changePercent24h: Double?
    public let sparkline: [Double]?

    public var isPositive: Bool { (changePercent24h ?? 0) >= 0 }
}

public struct AssetDetail: Codable, Sendable, Hashable {
    public let symbol: String
    public let name: String
    public let price: Decimal
    public let change24h: Double
    public let marketCap: Decimal?
    public let volume24h: Decimal?
    public let high24h: Decimal?
    public let low24h: Decimal?
    public let guardianScore: Int?
    public let guardianVerdict: String?
}

public struct Candle: Identifiable, Codable, Sendable, Hashable {
    public var id: Date { time }
    public let time: Date
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
}

// MARK: - Portfolio

public struct Position: Identifiable, Codable, Sendable, Hashable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let quantity: Decimal
    public let avgCost: Decimal
    public let currentPrice: Decimal
    public let marketValue: Decimal
    public let unrealizedPnl: Decimal
    public let unrealizedPnlPercent: Double
}

public struct PortfolioSummary: Codable, Sendable, Hashable {
    public let totalUsd: Decimal
    public let dayChangeUsd: Decimal
    public let dayChangePercent: Double
    public let positions: [Position]

    public init(
        totalUsd: Decimal, dayChangeUsd: Decimal,
        dayChangePercent: Double, positions: [Position]
    ) {
        self.totalUsd = totalUsd
        self.dayChangeUsd = dayChangeUsd
        self.dayChangePercent = dayChangePercent
        self.positions = positions
    }

    public static let empty = PortfolioSummary(
        totalUsd: 0, dayChangeUsd: 0, dayChangePercent: 0, positions: []
    )

    /// Diversification and stablecoin share, as shown by the Wear OS health
    /// meter. Both are derived here rather than on the watch so the phone and
    /// the watch can never disagree about the number.
    public var diversificationScore: Double {
        guard totalUsd > 0, positions.count > 1 else { return 0 }
        // Herfindahl-Hirschman, inverted and normalised to 0...1. A single
        // holding scores 0; perfectly even holdings score 1.
        let shares = positions.map { NSDecimalNumber(decimal: $0.marketValue / totalUsd).doubleValue }
        let hhi = shares.reduce(0) { $0 + $1 * $1 }
        let n = Double(positions.count)
        guard n > 1 else { return 0 }
        return max(0, min(1, (1 - hhi) / (1 - 1 / n)))
    }

    /// The position that moved the most today, by absolute percentage. Used by
    /// the voice answer and the portfolio complication.
    ///
    /// Absolute, not signed: "your biggest mover" is as much about a 9% drop as
    /// a 9% gain, and reporting only gainers would be a cheerful lie.
    public var topMover: Position? {
        positions.max { abs($0.unrealizedPnlPercent) < abs($1.unrealizedPnlPercent) }
    }

    public var stablecoinShare: Double {
        guard totalUsd > 0 else { return 0 }
        let stables: Set<String> = ["USDC", "USDT", "DAI", "PYUSD", "USDP", "TUSD", "FDUSD"]
        let stableValue = positions
            .filter { stables.contains($0.symbol.uppercased()) }
            .reduce(Decimal.zero) { $0 + $1.marketValue }
        return NSDecimalNumber(decimal: stableValue / totalUsd).doubleValue
    }
}

// MARK: - Travel

public enum BookingStatus: String, Codable, Sendable {
    case draft, confirmed, cancelled, completed, unknown
}

public struct FlightSegment: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let carrier: String
    public let flightNumber: String
    public let origin: String
    public let destination: String
    public let departsAt: Date
    public let arrivesAt: Date
    public let status: String?
}

public struct HotelBooking: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let city: String
    public let checkIn: Date
    public let checkOut: Date
}

public struct TravelBooking: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let destination: String
    public let startDate: Date
    public let endDate: Date
    public let status: BookingStatus
    public let flights: [FlightSegment]?
    public let hotel: HotelBooking?

    public var isActive: Bool {
        status == .confirmed && endDate >= Date()
    }
}

public struct TravelDeal: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let destination: String
    public let price: Decimal
    public let originalPrice: Decimal?
    public let imageUrl: String?
    public let expiresAt: Date?

    public var discountPercent: Int? {
        guard let original = originalPrice, original > 0, price < original else { return nil }
        let ratio = (original - price) / original
        return Int(NSDecimalNumber(decimal: ratio).doubleValue * 100)
    }
}
