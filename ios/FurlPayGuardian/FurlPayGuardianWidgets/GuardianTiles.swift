//
//  GuardianTiles.swift
//
//  Port of the seven Wear OS TileServices (Wallet, Portfolio, Market,
//  NextEvent, Travel, QuickPay, TileSupport).
//
//  watchOS has no Tiles API. The Smart Stack — accessory-family widgets the
//  user swipes to from the watch face — is the equivalent surface, and the
//  design rules carry over unchanged:
//
//    * Snapshot cache ONLY. A tile that blocks on the network shows a
//      placeholder, and the whole point of the surface is that it is already
//      there when the wrist comes up.
//    * One number, one action. Every tile deep-links into the screen it
//      summarises — a Wallet tile that opens the home menu makes the user
//      navigate twice.
//
//  The Android freshness intervals are carried over as timeline reload
//  policies: 30 min for wallet/portfolio, 15 min for market/event/travel.
//

import WidgetKit
import SwiftUI

// MARK: - Shared plumbing

/// Deep-link target. `WatchApp` reads these and sets its start destination,
/// exactly as `WearMainActivity` reads the `guardian.route` intent extra.
enum TileRoute: String {
    case wallet, portfolio, markets, events, travel, quickpay

    var url: URL { URL(string: "furlpay://\(rawValue)")! }
}

/// One entry, built from the App Group snapshot. Shared by every tile below —
/// they differ in what they render, not in where the data comes from.
struct TileEntry: TimelineEntry {
    let date: Date
    let snapshot: GuardianSnapshot?

    var isStale: Bool { snapshot?.isStale ?? true }
}

struct TileProvider: TimelineProvider {
    let refreshMinutes: Int

    func placeholder(in context: Context) -> TileEntry {
        TileEntry(date: .now, snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (TileEntry) -> Void) {
        completion(TileEntry(date: .now, snapshot: SnapshotCache.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TileEntry>) -> Void) {
        completion(Timeline(
            entries: [TileEntry(date: .now, snapshot: SnapshotCache.load())],
            policy: .after(.now.addingTimeInterval(Double(refreshMinutes) * 60))
        ))
    }
}

/// The common tile body: a caption, a headline, and a tap target.
///
/// Colour is passed in rather than derived here because the money-semantic
/// palette (green up / red down) is the one place these tiles are allowed to
/// use colour at all — everything else stays monochrome so it survives the
/// tinted watch faces.
struct TileBody: View {
    let caption: String
    let headline: String
    var headlineColor: Color = .primary
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(caption)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(headline)
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(headlineColor)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if let detail {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private let dash = "—"

// MARK: - Wallet
//
// "How much do I have?" — one number on black, tap opens the wallet.

struct WalletTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.wallet",
            provider: TileProvider(refreshMinutes: 30)
        ) { entry in
            let total = entry.snapshot?.wallets?.totalUsd
            TileBody(
                caption: entry.isStale ? "Wallet · stale" : "Wallet",
                headline: total.map(\.usdCompact) ?? dash,
                detail: entry.snapshot?.wallets?.sortedByValue.first.map {
                    "\($0.currency) \($0.usdValue.usdCompact)"
                }
            )
            .widgetURL(TileRoute.wallet.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Wallet")
        .description("Your total balance.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Portfolio
//
// "+$42.30 today" — day change, green for gains, red for losses.

struct PortfolioTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.portfolio",
            provider: TileProvider(refreshMinutes: 30)
        ) { entry in
            let portfolio = entry.snapshot?.portfolio
            let change = portfolio?.dayChangeUsd
            TileBody(
                caption: portfolio?.topMover.map { "\($0.symbol) \($0.unrealizedPnlPercent.signedPercent)" }
                    ?? "Portfolio",
                headline: change.map { ($0 >= 0 ? "+" : "\u{2212}") + abs($0).usdCompact } ?? dash,
                headlineColor: change.map { GuardianColors.forChange($0.doubleValue) } ?? .secondary,
                detail: portfolio?.totalUsd.usdCompact
            )
            .widgetURL(TileRoute.portfolio.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Portfolio")
        .description("Today's change.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Market
//
// "BTC $68,421 ▼2.1%" — headline quote plus the rest of the watchlist.

struct MarketTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.market",
            provider: TileProvider(refreshMinutes: 15)
        ) { entry in
            let quotes = entry.snapshot?.markets ?? []
            let lead = quotes.first
            // `changePercent24h` and `price` are BOTH optional on MarketQuote.
            // A missing value renders the dash rather than defaulting to 0 —
            // a tile that says "+0.00%" when the quote never arrived is worse
            // than one that admits it has no number yet.
            TileBody(
                caption: lead?.changePercent24h.map(\.signedPercent) ?? "Markets",
                headline: lead.map { "\($0.symbol) \($0.price?.usdCompact ?? dash)" } ?? dash,
                headlineColor: lead?.changePercent24h.map(GuardianColors.forChange) ?? .secondary,
                detail: quotes.dropFirst().prefix(2)
                    .map { "\($0.symbol) \($0.changePercent24h.map(\.signedPercent) ?? dash)" }
                    .joined(separator: " · ")
            )
            .widgetURL(TileRoute.markets.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Markets")
        .description("Your watchlist.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Next event

struct NextEventTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.event",
            provider: TileProvider(refreshMinutes: 15)
        ) { entry in
            let next = entry.snapshot.flatMap { NextEvent.from($0, at: entry.date) }
            TileBody(
                caption: next == nil ? "nothing scheduled" : "Next up",
                headline: next?.title ?? "All clear",
                detail: next?.countdown
            )
            .widgetURL(TileRoute.events.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Next Event")
        .description("Your next meeting or reminder.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

/// Shared by the tile and the NextEvent complication so the two can never show
/// a different countdown for the same event.
enum NextEvent {
    static func from(_ snapshot: GuardianSnapshot, at now: Date) -> (title: String, countdown: String)? {
        guard let next = (snapshot.events ?? [])
            .filter({ !$0.acknowledged && $0.startAt >= now })
            .min(by: { $0.startAt < $1.startAt })
        else { return nil }

        let minutes = max(Int(next.startAt.timeIntervalSince(now) / 60), 0)
        let countdown: String
        if minutes < 60 {
            countdown = "in \(minutes)m"
        } else if minutes < 24 * 60 {
            countdown = "in \(minutes / 60)h \(minutes % 60)m"
        } else {
            countdown = "in \(minutes / (24 * 60))d"
        }
        return (next.title, countdown)
    }
}

// MARK: - Travel

struct TravelTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.travel",
            provider: TileProvider(refreshMinutes: 15)
        ) { entry in
            let trip = (entry.snapshot?.trips ?? []).first { $0.isActive }
            TileBody(
                caption: trip.map { _ in "Next trip" } ?? "Travel",
                headline: trip?.destination ?? "No trips",
                detail: trip.map { trip in
                    trip.flights?.first.map { "\($0.carrier)\($0.flightNumber) · \($0.departsAt.shortTime)" }
                        ?? trip.startDate.dayAndMonth
                }
            )
            .widgetURL(TileRoute.travel.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Travel")
        .description("Your next trip.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Quick pay
//
// The only tile with no data dependency: it is a shortcut to the receive code,
// so it renders identically whether or not a snapshot exists.

struct QuickPayTile: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "com.furlpay.guardian.tile.quickpay",
            provider: TileProvider(refreshMinutes: 60)
        ) { _ in
            VStack(spacing: 2) {
                Image(systemName: "qrcode").font(.title3)
                Text("Receive").font(.caption2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .widgetURL(TileRoute.quickpay.url)
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Receive")
        .description("Show your payment code.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}
