//
//  StockDetailView.swift
//
//  Asset detail, area chart with a scrubber, Guardian Score, and the order flow.
//
//  The order is biometric-gated here rather than two-step-confirmed. The watch
//  uses two taps because it has no sensor; the phone has one, so it should use
//  it — a manual double-confirm on a device capable of Face ID is security
//  theatre that trains the user to tap through.
//

import SwiftUI
import Charts

struct StockDetailView: View {
    let symbol: String

    @Environment(ServiceContainer.self) private var container
    @State private var detail: AssetDetail?
    @State private var candles: [Candle] = []
    @State private var timeframe = "1D"
    @State private var selected: Candle?
    @State private var orderSide: String?
    @State private var error: String?
    @State private var placing = false
    @State private var confirmation: String?

    private let timeframes = ["1D", "1W", "1M", "1Y"]
    private let notionals: [Decimal] = [25, 50, 100]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                priceHeader
                timeframePicker
                chart
                // Shown when EITHER source has something to say — the local
                // computation works with no `detail` at all.
                if localScore != nil || detail?.guardianScore != nil {
                    guardianScore(detail?.guardianScore ?? 0, detail?.guardianVerdict)
                }
                orderSection

                if let confirmation {
                    Text(confirmation)
                        .font(.footnote)
                        .foregroundStyle(GuardianColors.positive)
                }
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(GuardianColors.negative)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle(symbol)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: timeframe) { _, _ in Task { await loadBars() } }
    }

    // MARK: Sections

    private var priceHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(detail?.name ?? symbol)
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)
            // While scrubbing, show the scrubbed price — otherwise the chart
            // moves under the finger while the number above it does not.
            Text((selected.map { Decimal($0.close) } ?? detail?.price)?.usd ?? "—")
                .font(.system(size: 32, weight: .semibold, design: .rounded))
                .foregroundStyle(GuardianColors.textPrimary)
                .contentTransition(.numericText())
            if let change = detail?.change24h {
                Text(change.signedPercent)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.forChange(change))
            }
        }
    }

    private var timeframePicker: some View {
        Picker("Timeframe", selection: $timeframe) {
            ForEach(timeframes, id: \.self) { Text($0).tag($0) }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private var chart: some View {
        if candles.count > 1 {
            Chart(candles) { candle in
                AreaMark(x: .value("Time", candle.time), y: .value("Price", candle.close))
                    .foregroundStyle(.linearGradient(
                        colors: [GuardianColors.primaryAccent.opacity(0.35), .clear],
                        startPoint: .top, endPoint: .bottom
                    ))
                LineMark(x: .value("Time", candle.time), y: .value("Price", candle.close))
                    .foregroundStyle(GuardianColors.primaryAccent)

                if let selected, selected.id == candle.id {
                    RuleMark(x: .value("Time", selected.time))
                        .foregroundStyle(GuardianColors.textTertiary)
                }
            }
            .chartYScale(domain: yDomain)
            .frame(height: 200)
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let x = value.location.x - geo[proxy.plotAreaFrame].origin.x
                                    guard let date: Date = proxy.value(atX: x) else { return }
                                    selected = candles.min {
                                        abs($0.time.timeIntervalSince(date))
                                            < abs($1.time.timeIntervalSince(date))
                                    }
                                }
                                .onEnded { _ in selected = nil }
                        )
                }
            }
        } else {
            ProgressView().tint(GuardianColors.primaryAccent).frame(height: 200)
        }
    }

    /// Padded by 2% so the line never touches the frame edge.
    private var yDomain: ClosedRange<Double> {
        let closes = candles.map(\.close)
        guard let low = closes.min(), let high = closes.max(), low < high else { return 0...1 }
        let pad = (high - low) * 0.02
        return (low - pad)...(high + pad)
    }

    /// Computed from the bars already on screen. Falls back to the server's
    /// figure only when there is too little history to compute one — which
    /// means the panel works offline, where the server's number cannot.
    private var localScore: GuardianScore? {
        ComputeGuardianScore(closes: candles.map(\.close), timeframe: timeframe)
    }

    private func guardianScore(_ score: Int, _ verdict: String?) -> some View {
        let local = localScore
        let shown = local?.score ?? score
        let stance = local?.stance.rawValue ?? verdict

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Guardian Score").sectionTitle()
                    Text("\(shown)/100")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(GuardianColors.textPrimary)
                        .contentTransition(.numericText())
                }
                Spacer()
                if let stance {
                    Text(stance.uppercased())
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .background(verdictColour(stance).opacity(0.18))
                        .foregroundStyle(verdictColour(stance))
                        .clipShape(Capsule())
                }
            }

            if let local {
                // The reasoning, not just the number. A score with no "why" is
                // indistinguishable from a made-up one.
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(local.reasons, id: \.self) { reason in
                        Text("· \(reason)")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("\(local.confidence)% confidence · \(local.risk.rawValue) risk")
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.textTertiary)
                        .padding(.top, 2)
                }
            }
        }
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func verdictColour(_ verdict: String) -> Color {
        switch verdict.lowercased() {
        case "buy": GuardianColors.positive
        case "sell": GuardianColors.negative
        default: GuardianColors.warning
        }
    }

    private var orderSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Trade").sectionTitle()
            HStack(spacing: 10) {
                ForEach(["buy", "sell"], id: \.self) { side in
                    Button {
                        orderSide = orderSide == side ? nil : side
                    } label: {
                        Text(side.capitalized)
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .background(orderSide == side
                                        ? (side == "buy" ? GuardianColors.positive : GuardianColors.negative)
                                        : GuardianColors.surface)
                            .foregroundStyle(orderSide == side ? .white : GuardianColors.textPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            if let side = orderSide {
                HStack(spacing: 10) {
                    ForEach(notionals, id: \.self) { amount in
                        Button {
                            Task { await placeOrder(side: side, notional: amount) }
                        } label: {
                            Text(amount.usd)
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .background(GuardianColors.surfaceElevated)
                                .foregroundStyle(GuardianColors.textPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(placing)
                    }
                }
                Text("Face ID confirms before the order is sent.")
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textTertiary)
            }
        }
    }

    // MARK: Actions

    private func load() async {
        detail = await container.markets.detail(symbol: symbol)
        await loadBars()
    }

    private func loadBars() async {
        candles = await container.markets.bars(symbol: symbol, timeframe: timeframe)
    }

    private func placeOrder(side: String, notional: Decimal) async {
        error = nil
        confirmation = nil

        let result = await container.biometrics.authenticate(
            reason: "Confirm \(side) \(notional.usd) of \(symbol)"
        )
        guard result.isAuthenticated else {
            if case .unavailable(let why) = result { error = why }
            return
        }

        placing = true
        defer { placing = false }
        do {
            let response = try await container.portfolio.placeOrder(
                symbol: symbol, side: side, notionalUsd: notional
            )
            confirmation = "Order \(response.status). Reference \(response.orderId)."
            orderSide = nil
            await container.sync.pushAllSnapshots(from: container)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
