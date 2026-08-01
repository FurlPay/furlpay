//
//  MarketsView.swift
//
//  Markets watchlist, portfolio with health meter, and the stock detail with
//  its biometric-gated order flow. Charts use Swift Charts.
//

import SwiftUI
import Charts

// MARK: - Sparkline

struct SparklineView: View {
    let data: [Double]
    let isPositive: Bool
    var size = CGSize(width: 64, height: 26)

    var body: some View {
        // Two points make a line; one makes nothing. Drawing a Chart with a
        // single value renders a dot in the middle, which reads as a price.
        if data.count > 1 {
            Chart(Array(data.enumerated()), id: \.offset) { index, value in
                AreaMark(x: .value("t", index), y: .value("p", value))
                    .foregroundStyle(.linearGradient(
                        colors: [tint.opacity(0.35), .clear],
                        startPoint: .top, endPoint: .bottom
                    ))
                LineMark(x: .value("t", index), y: .value("p", value))
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartLegend(.hidden)
            // Auto-scaling to the data range, not to zero — a 0.4% move on a
            // zero-based axis is a flat line and says nothing.
            .chartYScale(domain: (data.min() ?? 0)...(data.max() ?? 1))
            .frame(width: size.width, height: size.height)
        } else {
            Color.clear.frame(width: size.width, height: size.height)
        }
    }

    private var tint: Color { isPositive ? GuardianColors.positive : GuardianColors.negative }
}

// MARK: - Markets

struct MarketsView: View {
    @Environment(ServiceContainer.self) private var container

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !container.markets.biggestMovers.isEmpty {
                    Text("Biggest Movers").sectionTitle()
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(container.markets.biggestMovers.prefix(6)) { quote in
                                NavigationLink { StockDetailView(symbol: quote.symbol) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(quote.symbol)
                                            .font(.caption.weight(.bold))
                                            .foregroundStyle(GuardianColors.textPrimary)
                                        Text((quote.changePercent24h ?? 0).signedPercent)
                                            .font(.caption2.weight(.medium))
                                            .foregroundStyle(GuardianColors.forChange(quote.changePercent24h ?? 0))
                                    }
                                    .padding(12)
                                    .frame(width: 96, alignment: .leading)
                                    .background(GuardianColors.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                Text("Watchlist").sectionTitle()
                ForEach(container.markets.quotes) { quote in
                    NavigationLink { StockDetailView(symbol: quote.symbol) } label: {
                        QuoteRow(quote: quote)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Markets")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.markets.refresh() }
    }
}

struct QuoteRow: View {
    let quote: MarketQuote

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(quote.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text(quote.name)
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textTertiary)
                    .lineLimit(1)
            }

            Spacer()
            SparklineView(data: quote.sparkline ?? [], isPositive: quote.isPositive)

            VStack(alignment: .trailing, spacing: 2) {
                Text(quote.price?.usd ?? "—")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(GuardianColors.textPrimary)
                Text((quote.changePercent24h ?? 0).signedPercent)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(GuardianColors.forChange(quote.changePercent24h ?? 0))
            }
            .frame(width: 92, alignment: .trailing)
        }
        .padding(14)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Portfolio

struct PortfolioView: View {
    @Environment(ServiceContainer.self) private var container

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let summary = container.portfolio.summary {
                    VStack(spacing: 6) {
                        Text(summary.totalUsd.usd)
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text("\(summary.dayChangeUsd.usd) · \(summary.dayChangePercent.signedPercent) today")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(GuardianColors.forChange(summary.dayChangePercent))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(22)
                    .background(GuardianColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                    HealthMeterView(summary: summary)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Holdings").sectionTitle()
                        ForEach(summary.positions.sorted { $0.marketValue > $1.marketValue }) { position in
                            NavigationLink { StockDetailView(symbol: position.symbol) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(position.symbol)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(GuardianColors.textPrimary)
                                        Text(position.quantity.quantity)
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(GuardianColors.textTertiary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(position.marketValue.usd)
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(GuardianColors.textPrimary)
                                        Text(position.unrealizedPnlPercent.signedPercent)
                                            .font(.caption2)
                                            .foregroundStyle(GuardianColors.forChange(position.unrealizedPnlPercent))
                                    }
                                }
                                .padding(14)
                                .background(GuardianColors.surface)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else {
                    ProgressView().tint(GuardianColors.primaryAccent).padding(.top, 60)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Portfolio")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.portfolio.refresh() }
    }
}

/// Diversification and stablecoin share. Both numbers come from
/// `PortfolioSummary` rather than being computed here, so the watch shows the
/// identical value.
struct HealthMeterView: View {
    let summary: PortfolioSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Health").sectionTitle()
            bar("Diversification", value: summary.diversificationScore, tint: GuardianColors.primaryAccent)
            bar("Stablecoins", value: summary.stablecoinShare, tint: GuardianColors.positive)
        }
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func bar(_ label: String, value: Double, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
                Spacer()
                Text("\(Int(value * 100))%")
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(GuardianColors.surfaceElevated)
                    Capsule().fill(tint)
                        .frame(width: geo.size.width * min(max(value, 0), 1))
                }
            }
            .frame(height: 6)
        }
    }
}
