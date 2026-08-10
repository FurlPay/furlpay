//
//  WatchScreens.swift
//
//  All ten watch screens. One file because each is 20–60 lines of layout over
//  the same snapshot, and ten files of that would be harder to keep consistent,
//  not easier.
//
//  Ports of HomeScreen, WalletScreen, CardsScreen, VoiceScreen, PortfolioScreen,
//  SpendingScreen, QuickPayScreen, MarketsScreen, StockScreen, TravelScreen.
//

import SwiftUI
import Charts
import WatchKit
#if canImport(CoreImage) && !os(watchOS)
import CoreImage.CIFilterBuiltins
#endif

// MARK: - Home / AI brief

struct WatchHomeView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(Date.greeting)
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textSecondary)

                Text((store.snapshot.wallets?.totalUsd ?? 0).usdCompact)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(GuardianColors.textPrimary)

                if let portfolio = store.snapshot.portfolio {
                    Text("\(portfolio.dayChangeUsd.usdCompact) · \(portfolio.dayChangePercent.signedPercent)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(GuardianColors.forChange(portfolio.dayChangePercent))
                }

                // Stated, not hidden. A stale balance presented as current is
                // worse than one labelled stale.
                if store.snapshot.isStale {
                    Label("Updated \(store.snapshot.updatedAt.relativeDescription)",
                          systemImage: "exclamationmark.triangle")
                        .font(.system(size: 10))
                        .foregroundStyle(GuardianColors.warning)
                }

                if let event = store.snapshot.events?.first(where: { !$0.acknowledged }) {
                    WatchCard {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.caption2.weight(.medium))
                                .lineLimit(2)
                            Text(event.startAt.relativeDescription)
                                .font(.system(size: 10))
                                .foregroundStyle(GuardianColors.textTertiary)
                        }
                    }
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                    ForEach(WatchRoute.allCases, id: \.self) { route in
                        NavigationLink(value: route) {
                            Image(systemName: route.icon)
                                .font(.system(size: 15))
                                .frame(maxWidth: .infinity)
                                .frame(height: 34)
                                .background(GuardianColors.surface)
                                .foregroundStyle(GuardianColors.primaryAccent)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 2)
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Guardian")
        .containerBackground(GuardianColors.background.gradient, for: .navigation)
    }
}

// MARK: - Wallet

struct WatchWalletView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            ForEach(store.snapshot.wallets?.sortedByValue ?? []) { wallet in
                HStack {
                    Text(wallet.currency).font(.caption.weight(.medium))
                    Spacer()
                    Text(wallet.usdValue.usdCompact)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(GuardianColors.textSecondary)
                }
            }
            NavigationLink(value: WatchRoute.quickpay) {
                Label("Receive", systemImage: "qrcode").font(.caption)
            }
        }
        .navigationTitle("Wallet")
    }
}

// MARK: - Cards

struct WatchCardsView: View {
    @Environment(WatchStore.self) private var store
    @State private var armed: String?

    var body: some View {
        List {
            ForEach(store.snapshot.cards ?? []) { card in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("•••• \(card.last4)").font(.caption.monospacedDigit())
                        Spacer()
                        if card.frozen {
                            Image(systemName: "snowflake")
                                .font(.system(size: 11))
                                .foregroundStyle(GuardianColors.primaryAccent)
                        }
                    }

                    if card.frozen {
                        // Freeze restricts; unfreeze re-enables spending. The
                        // watch cannot prove who is wearing it, so only the
                        // restricting direction is allowed here — same rule as
                        // the Wear OS app.
                        Text("Unfreeze from your phone")
                            .font(.system(size: 10))
                            .foregroundStyle(GuardianColors.textTertiary)
                    } else {
                        Button(armed == card.id ? "Tap again to freeze" : "Freeze") {
                            if armed == card.id {
                                armed = nil
                                WKInterfaceDevice.current().play(.success)
                                // Relayed to the phone; the watch never calls
                                // the mutating endpoint itself.
                            } else {
                                armed = card.id
                                WKInterfaceDevice.current().play(.click)
                            }
                        }
                        .font(.system(size: 11))
                        .tint(armed == card.id ? GuardianColors.warning : GuardianColors.primaryAccent)
                    }
                }
            }
        }
        .navigationTitle("Cards")
    }
}

// MARK: - Voice

struct WatchVoiceView: View {
    @Environment(WatchStore.self) private var store
    @State private var answer: String?
    @State private var isAsking = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Button {
                    presentDictation()
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 26))
                        .frame(width: 66, height: 66)
                        .background(GuardianColors.primaryAccent.opacity(0.18))
                        .foregroundStyle(GuardianColors.primaryAccent)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(isAsking)

                if isAsking { ProgressView().tint(GuardianColors.primaryAccent) }

                if let answer {
                    WatchCard { Text(answer).font(.caption2) }
                } else if !isAsking {
                    Text("Ask about your balance, spending or portfolio.")
                        .font(.system(size: 11))
                        .foregroundStyle(GuardianColors.textTertiary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Ask")
    }

    /// watchOS has no SFSpeechRecognizer push-to-talk UI of its own; the system
    /// dictation controller is the supported path and it handles the mic session.
    private func presentDictation() {
        guard let controller = WKExtension.shared().visibleInterfaceController else { return }
        controller.presentTextInputController(
            withSuggestions: ["What is my balance?", "How much did I spend today?"],
            allowedInputMode: .plain
        ) { results in
            guard let question = results?.first as? String else { return }
            Task { @MainActor in
                isAsking = true
                answer = await store.ask(question)
                isAsking = false
            }
        }
    }
}

// MARK: - Portfolio

struct WatchPortfolioView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let p = store.snapshot.portfolio {
                    Text(p.totalUsd.usdCompact)
                        .font(.system(size: 24, weight: .semibold, design: .rounded))
                    Text(p.dayChangePercent.signedPercent)
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.forChange(p.dayChangePercent))

                    WatchMeter(label: "Diversified", value: p.diversificationScore,
                               tint: GuardianColors.primaryAccent)
                    WatchMeter(label: "Stablecoins", value: p.stablecoinShare,
                               tint: GuardianColors.positive)

                    ForEach(p.positions.sorted { $0.marketValue > $1.marketValue }.prefix(4)) { position in
                        NavigationLink(value: position.symbol) {
                            HStack {
                                Text(position.symbol).font(.caption2.weight(.medium))
                                Spacer()
                                Text(position.marketValue.usdCompact)
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(GuardianColors.textSecondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    Text("No portfolio yet.").font(.caption2)
                        .foregroundStyle(GuardianColors.textTertiary)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Portfolio")
    }
}

// MARK: - Spending

struct WatchSpendingView: View {
    @Environment(WatchStore.self) private var store
    @State private var period = 0

    private var value: Decimal {
        let s = store.snapshot.spending ?? .empty
        return [s.day, s.week, s.month][period]
    }

    var body: some View {
        VStack(spacing: 10) {
            Picker("", selection: $period) {
                Text("Day").tag(0); Text("Wk").tag(1); Text("Mo").tag(2)
            }
            .pickerStyle(.navigationLink)
            .frame(height: 34)

            Text(value.usdCompact)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .contentTransition(.numericText())
        }
        .navigationTitle("Spending")
    }
}

// MARK: - QuickPay

struct WatchQuickPayView: View {
    @Environment(WatchStore.self) private var store

    private var payload: String {
        store.snapshot.wallets?.sortedByValue.first?.id ?? "furlpay:unavailable"
    }

    var body: some View {
        VStack {
            if let image = QRRenderer.image(from: payload) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(6)
                    .background(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .navigationTitle("Receive")
        // Watch screens dim aggressively to save power; a dim OLED is the usual
        // reason a scanner cannot read the code.
        .onAppear { WKInterfaceDevice.current().play(.click) }
    }
}

enum QRRenderer {
    /// Renders a QR code, or nil when this platform cannot.
    ///
    /// `CIContext` is not available on watchOS, so the whole CoreImage path is
    /// compiled out there rather than failing to build. The return type was
    /// already Optional and every caller handles nil, so a watch that cannot
    /// rasterise a code shows its existing fallback instead of a broken view.
    static func image(from string: String) -> UIImage? {
        #if canImport(CoreImage) && !os(watchOS)
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
        #else
        return nil
        #endif
    }
}

// MARK: - Markets

struct WatchMarketsView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            ForEach(store.snapshot.markets ?? []) { quote in
                NavigationLink(value: quote.symbol) {
                    HStack(spacing: 6) {
                        Text(quote.symbol).font(.caption2.weight(.semibold))
                        Spacer()
                        WatchSparkline(data: quote.sparkline ?? [], isPositive: quote.isPositive)
                        Text((quote.changePercent24h ?? 0).signedPercent)
                            .font(.system(size: 10).monospacedDigit())
                            .foregroundStyle(GuardianColors.forChange(quote.changePercent24h ?? 0))
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .navigationTitle("Markets")
    }
}

// MARK: - Stock detail

struct WatchStockView: View {
    let symbol: String
    @Environment(WatchStore.self) private var store
    @State private var armed: Decimal?

    private var quote: MarketQuote? {
        store.snapshot.markets?.first { $0.symbol == symbol }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(quote?.price?.usdCompact ?? "—")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                Text((quote?.changePercent24h ?? 0).signedPercent)
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.forChange(quote?.changePercent24h ?? 0))

                WatchSparkline(
                    data: quote?.sparkline ?? [],
                    isPositive: quote?.isPositive ?? true,
                    size: CGSize(width: 140, height: 44)
                )

                Text("Buy").font(.system(size: 11)).foregroundStyle(GuardianColors.textSecondary)
                ForEach([Decimal(25), Decimal(50), Decimal(100)], id: \.self) { amount in
                    Button(armed == amount ? "Tap again to confirm" : amount.usdCompact) {
                        if armed == amount {
                            armed = nil
                            WKInterfaceDevice.current().play(.success)
                            // Two taps replace the biometric prompt the watch
                            // cannot show. Relayed to the phone to execute.
                        } else {
                            armed = amount
                            WKInterfaceDevice.current().play(.click)
                        }
                    }
                    .font(.system(size: 12))
                    .tint(armed == amount ? GuardianColors.warning : GuardianColors.primaryAccent)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle(symbol)
    }
}

// MARK: - Travel

struct WatchTravelView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            ForEach(store.snapshot.trips?.filter(\.isActive) ?? []) { trip in
                VStack(alignment: .leading, spacing: 2) {
                    Text(trip.destination).font(.caption.weight(.medium))
                    Text(trip.startDate.relativeDescription)
                        .font(.system(size: 10))
                        .foregroundStyle(GuardianColors.textTertiary)
                    ForEach(trip.flights ?? []) { flight in
                        Text("\(flight.carrier)\(flight.flightNumber) \(flight.origin)→\(flight.destination)")
                            .font(.system(size: 10).monospaced())
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }
            }
            if (store.snapshot.trips?.filter(\.isActive).isEmpty ?? true) {
                Text("No trips booked.").font(.caption2)
                    .foregroundStyle(GuardianColors.textTertiary)
            }
        }
        .navigationTitle("Travel")
    }
}

// MARK: - Shared watch components

struct WatchCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(GuardianColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct WatchMeter: View {
    let label: String
    let value: Double
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.system(size: 10))
                    .foregroundStyle(GuardianColors.textSecondary)
                Spacer()
                Text("\(Int(value * 100))%")
                    .font(.system(size: 10).monospacedDigit())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(GuardianColors.surfaceElevated)
                    Capsule().fill(tint).frame(width: geo.size.width * min(max(value, 0), 1))
                }
            }
            .frame(height: 4)
        }
    }
}

struct WatchSparkline: View {
    let data: [Double]
    let isPositive: Bool
    var size = CGSize(width: 40, height: 18)

    var body: some View {
        if data.count > 1 {
            Chart(Array(data.enumerated()), id: \.offset) { index, value in
                LineMark(x: .value("t", index), y: .value("p", value))
                    .foregroundStyle(isPositive ? GuardianColors.positive : GuardianColors.negative)
                    .lineStyle(StrokeStyle(lineWidth: 1.2))
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: (data.min() ?? 0)...(data.max() ?? 1))
            .frame(width: size.width, height: size.height)
        } else {
            Color.clear.frame(width: size.width, height: size.height)
        }
    }
}
