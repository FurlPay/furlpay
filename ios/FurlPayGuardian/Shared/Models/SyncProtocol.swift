//
//  SyncProtocol.swift
//
//  The phone↔watch contract, ported from guardian/core/sync (DataLayerManager +
//  MessageRouter). Both targets compile this same file, so a key can never be
//  spelled one way on the phone and another on the watch — the failure mode
//  that makes DataLayer bugs so hard to see, because nothing errors, data just
//  never arrives.
//

import Foundation

public enum SyncKey {
    public static let token = "token"
    public static let wallets = "wallets"
    public static let events = "events"
    public static let trips = "trips"
    public static let portfolio = "portfolio"
    public static let spending = "spending"
    public static let markets = "markets"
    public static let cards = "cards"
    public static let updatedAt = "updatedAt"

    /// Phone → watch: the session has ended, drop everything.
    ///
    /// A DISTINCT KEY, not an empty `token`. Two reasons, and both were live
    /// bugs rather than hypotheticals:
    ///
    ///   1. The watch's receive path guards on `!token.isEmpty`, so an empty
    ///      string is silently discarded — the technique the Android app uses
    ///      to clear its watch would have been a no-op here.
    ///   2. An empty string is indistinguishable from a truncated or failed
    ///      payload. "Sign out" and "the token did not arrive" must not be the
    ///      same wire value when one of them wipes the session.
    ///
    /// Carried as a Bool so the intent is explicit on the wire.
    public static let signOut = "sign_out"

    /// Watch → phone.
    public static let voiceCommand = "voice_command"
    public static let voiceResponse = "response"
    public static let requestRefresh = "request_refresh"
    /// Watch → phone: an action the watch may not perform itself.
    public static let relayAction = "relay_action"
}

/// One payload carrying every snapshot the watch renders.
///
/// Sent whole rather than per-key because `transferUserInfo` queues each call
/// separately, and a watch that received wallets but not portfolio would render
/// a half-populated Home screen with no way to tell that it had.
public struct GuardianSnapshot: Codable, Sendable {
    public var wallets: WalletOverview?
    public var cards: [Card]?
    public var events: [GuardianEvent]?
    public var trips: [TravelBooking]?
    public var portfolio: PortfolioSummary?
    public var spending: SpendingSummary?
    public var markets: [MarketQuote]?
    public var updatedAt: Date

    public init(
        wallets: WalletOverview? = nil,
        cards: [Card]? = nil,
        events: [GuardianEvent]? = nil,
        trips: [TravelBooking]? = nil,
        portfolio: PortfolioSummary? = nil,
        spending: SpendingSummary? = nil,
        markets: [MarketQuote]? = nil,
        updatedAt: Date = Date()
    ) {
        self.wallets = wallets
        self.cards = cards
        self.events = events
        self.trips = trips
        self.portfolio = portfolio
        self.spending = spending
        self.markets = markets
        self.updatedAt = updatedAt
    }

    /// Older than this and the watch shows its staleness rather than presenting
    /// the numbers as current. A wrong balance shown confidently is worse than
    /// a balance labelled stale.
    public static let freshnessWindow: TimeInterval = 30 * 60

    public var isStale: Bool {
        Date().timeIntervalSince(updatedAt) > Self.freshnessWindow
    }
}

/// WCSession dictionaries accept only property-list types, so models cross as
/// encoded `Data` under a single key. Passing a `[String: Any]` of raw model
/// values fails at runtime, silently, on the receiving side.
public enum SyncCodec {
    public static let payloadKey = "payload"

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public static func encode(_ snapshot: GuardianSnapshot) throws -> [String: Any] {
        [payloadKey: try encoder.encode(snapshot)]
    }

    public static func decode(_ userInfo: [String: Any]) -> GuardianSnapshot? {
        guard let data = userInfo[payloadKey] as? Data else { return nil }
        return try? decoder.decode(GuardianSnapshot.self, from: data)
    }
}

/// Local mirror of the last snapshot, in the App Group so the widget extension
/// can read it. Complications must never make a network call — WidgetKit budgets
/// their refreshes and a request would frequently not finish.
public enum SnapshotCache {
    /// App Group backing the cache.
    ///
    /// ENVIRONMENT-SCOPED. This was a bare `group.com.furlpay.guardian`, which
    /// was correct while one build existed. With dev/staging/prod installable
    /// side by side it would mean three apps sharing one container: the staging
    /// app would overwrite the production snapshot, and the production widget
    /// would render staging balances on the user's watch face with no way to
    /// tell. The suffix comes from the same xcconfig that sets the bundle id,
    /// so the container follows the app it belongs to.
    ///
    /// The matching group MUST exist in each target's .entitlements and be
    /// provisioned in the developer portal — an unprovisioned group makes
    /// `UserDefaults(suiteName:)` return nil, and every accessor below already
    /// degrades to "no cached snapshot" rather than crashing.
    public static let appGroup: String = {
        let suffix = Bundle.main.object(forInfoDictionaryKey: "FurlPayBundleSuffix") as? String ?? ""
        return "group.com.furlpay.guardian\(suffix)"
    }()

    private static let key = "guardian.snapshot"

    public static func save(_ snapshot: GuardianSnapshot) {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: key)
    }

    public static func load() -> GuardianSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: key) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(GuardianSnapshot.self, from: data)
    }

    /// Drop the cached snapshot on sign-out.
    ///
    /// Clearing the token without clearing this would leave the previous
    /// account's balances and card digits rendering on the watch face and in
    /// the Smart Stack — surfaces that never make a network call, so nothing
    /// would ever refresh them away.
    public static func clear() {
        UserDefaults(suiteName: appGroup)?.removeObject(forKey: key)
    }
}
