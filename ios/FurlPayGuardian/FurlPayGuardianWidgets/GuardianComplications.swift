//
//  GuardianComplications.swift
//
//  Balance and daily-spend complications, replacing the Wear OS
//  BalanceComplicationService and DailySpendComplicationService.
//
//  These read the App Group snapshot and NEVER touch the network. WidgetKit
//  budgets complication refreshes tightly; a URLSession here would frequently
//  not finish before the timeline was rendered, and the complication would show
//  a placeholder on a watch face — the most visible surface in the product.
//

import WidgetKit
import SwiftUI

// MARK: - Entry

struct GuardianEntry: TimelineEntry {
    let date: Date
    let totalBalance: Decimal
    let daySpend: Decimal
    let dayChangePercent: Double
    let isStale: Bool
    /// Carried whole for the complications that need more than a headline
    /// number (next event, top mover). Nil in the placeholder.
    let snapshot: GuardianSnapshot?

    static let placeholder = GuardianEntry(
        date: .now, totalBalance: 12_847.32, daySpend: 84.20,
        dayChangePercent: 2.4, isStale: false, snapshot: nil
    )
}

struct GuardianProvider: TimelineProvider {
    func placeholder(in context: Context) -> GuardianEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (GuardianEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GuardianEntry>) -> Void) {
        // One entry, refreshed in 15 minutes. Projecting a series forward would
        // mean inventing balances the app has not been told about.
        let timeline = Timeline(
            entries: [entry()],
            policy: .after(.now.addingTimeInterval(15 * 60))
        )
        completion(timeline)
    }

    private func entry() -> GuardianEntry {
        guard let snapshot = SnapshotCache.load() else { return .placeholder }
        return GuardianEntry(
            date: .now,
            totalBalance: snapshot.wallets?.totalUsd ?? 0,
            daySpend: snapshot.spending?.day ?? 0,
            dayChangePercent: snapshot.portfolio?.dayChangePercent ?? 0,
            isStale: snapshot.isStale,
            snapshot: snapshot
        )
    }
}

// MARK: - Balance

struct BalanceComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.furlpay.guardian.balance", provider: GuardianProvider()) { entry in
            BalanceComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Balance")
        .description("Your total FurlPay balance.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct BalanceComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GuardianEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "wallet.bifold").font(.system(size: 11))
                    Text(entry.totalBalance.usdCompact)
                        .font(.system(size: 12, weight: .medium))
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
            }

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("FurlPay").font(.caption2).foregroundStyle(.secondary)
                Text(entry.totalBalance.usdCompact).font(.headline)
                Text(entry.dayChangePercent.signedPercent)
                    .font(.caption2)
                    // Watch faces are rendered in tints the app does not choose;
                    // a hardcoded green can end up invisible on a tinted face.
                    .foregroundStyle(.secondary)
            }

        default:
            Text(entry.totalBalance.usdCompact)
        }
    }
}

// MARK: - Daily spend

struct DailySpendComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.furlpay.guardian.dayspend", provider: GuardianProvider()) { entry in
            DailySpendComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Spent Today")
        .description("What you have spent since midnight.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct DailySpendComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GuardianEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "arrow.down.circle").font(.system(size: 11))
                    Text(entry.daySpend.usdCompact)
                        .font(.system(size: 12, weight: .medium))
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Spent today").font(.caption2).foregroundStyle(.secondary)
                Text(entry.daySpend.usdCompact).font(.headline)
            }
        default:
            Text(entry.daySpend.usdCompact)
        }
    }
}

// MARK: - Next event
//
// Port of NextEventComplicationService. Shares NextEvent.from with the tile so
// the two surfaces can never disagree about the countdown.

struct NextEventComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.furlpay.guardian.nextevent", provider: GuardianProvider()) { entry in
            NextEventComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Next Event")
        .description("Your next meeting or reminder.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct NextEventComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GuardianEntry

    private var next: (title: String, countdown: String)? {
        entry.snapshot.flatMap { NextEvent.from($0, at: entry.date) }
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "calendar").font(.system(size: 11))
                    // The countdown, not the title: a title never fits a
                    // circular complication legibly.
                    Text(next?.countdown.replacingOccurrences(of: "in ", with: "") ?? "—")
                        .font(.system(size: 12, weight: .medium))
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(next == nil ? "Schedule" : "Next up")
                    .font(.caption2).foregroundStyle(.secondary)
                Text(next?.title ?? "All clear").font(.headline).lineLimit(1)
                if let countdown = next?.countdown {
                    Text(countdown).font(.caption2).foregroundStyle(.secondary)
                }
            }
        default:
            Text(next.map { "\($0.title) \($0.countdown)" } ?? "All clear")
        }
    }
}

// MARK: - Portfolio change
//
// Port of PortfolioChangeComplicationService.

struct PortfolioChangeComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.furlpay.guardian.portfoliochange", provider: GuardianProvider()) { entry in
            PortfolioChangeComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Portfolio Change")
        .description("Today's portfolio move.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct PortfolioChangeComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GuardianEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: entry.dayChangePercent >= 0
                          ? "chart.line.uptrend.xyaxis" : "chart.line.downtrend.xyaxis")
                        .font(.system(size: 11))
                    Text(entry.dayChangePercent.signedPercent)
                        .font(.system(size: 12, weight: .medium))
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("Portfolio").font(.caption2).foregroundStyle(.secondary)
                Text(entry.dayChangePercent.signedPercent).font(.headline)
                if let mover = entry.snapshot?.portfolio?.topMover {
                    Text("\(mover.symbol) \(mover.unrealizedPnlPercent.signedPercent)")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        default:
            Text(entry.dayChangePercent.signedPercent)
        }
    }
}

@main
struct GuardianWidgetBundle: WidgetBundle {
    var body: some Widget {
        // Complications — watch faces.
        BalanceComplication()
        DailySpendComplication()
        NextEventComplication()
        PortfolioChangeComplication()
        // Smart Stack — the Wear OS Tiles equivalent.
        WalletTile()
        PortfolioTile()
        MarketTile()
        NextEventTile()
        TravelTile()
        QuickPayTile()
    }
}
