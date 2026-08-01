//
//  SimpleScreens.swift
//
//  Wallet, Spending and QuickPay. Grouped because each is one list or one
//  graphic with no view model of its own — splitting them into three files
//  would add navigation cost without adding structure.
//

import SwiftUI
import CoreImage.CIFilterBuiltins

// MARK: - Wallet

struct WalletView: View {
    @Environment(ServiceContainer.self) private var container

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                VStack(spacing: 4) {
                    Text("Total")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textSecondary)
                    Text(container.wallets.totalUsd.usd)
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .foregroundStyle(GuardianColors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .padding(20)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                // Largest first — matches the Wear OS ordering so the two
                // screens never disagree about which balance leads.
                ForEach(container.wallets.overview?.sortedByValue ?? []) { wallet in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(wallet.currency)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(GuardianColors.textPrimary)
                            if let chain = wallet.chain {
                                Text(chain)
                                    .font(.caption2)
                                    .foregroundStyle(GuardianColors.textTertiary)
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(wallet.usdValue.usd)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(GuardianColors.textPrimary)
                            Text(wallet.balance.quantity)
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(GuardianColors.textSecondary)
                        }
                    }
                    .padding(16)
                    .background(GuardianColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                NavigationLink { QuickPayView() } label: {
                    Label("Receive", systemImage: "qrcode")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(GuardianColors.primaryAccent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.top, 6)
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Wallet")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.wallets.refresh() }
    }
}

// MARK: - Spending

struct SpendingView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var period: Period = .day

    enum Period: String, CaseIterable, Identifiable {
        case day = "Day", week = "Week", month = "Month"
        var id: String { rawValue }
    }

    private var total: Decimal {
        let summary = container.transactions.spendingSummary
        return switch period {
        case .day: summary.day
        case .week: summary.week
        case .month: summary.month
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Picker("Period", selection: $period) {
                    ForEach(Period.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                VStack(spacing: 6) {
                    Text("Spent this \(period.rawValue.lowercased())")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textSecondary)
                    Text(total.usd)
                        .font(.system(size: 36, weight: .semibold, design: .rounded))
                        .foregroundStyle(GuardianColors.textPrimary)
                        .contentTransition(.numericText())
                }
                .frame(maxWidth: .infinity)
                .padding(24)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent").sectionTitle()
                    ForEach(container.transactions.transactions.prefix(20)) { tx in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tx.description)
                                    .font(.subheadline)
                                    .foregroundStyle(GuardianColors.textPrimary)
                                    .lineLimit(1)
                                Text(tx.at.relativeDescription)
                                    .font(.caption2)
                                    .foregroundStyle(GuardianColors.textTertiary)
                            }
                            Spacer()
                            Text((tx.direction == .debit ? "-" : "+") + tx.amountUsd.usd)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(tx.direction == .debit
                                                 ? GuardianColors.textPrimary
                                                 : GuardianColors.positive)
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .background(GuardianColors.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Spending")
        .navigationBarTitleDisplayMode(.inline)
        .animation(.easeInOut(duration: 0.2), value: period)
        .refreshable { await container.transactions.refresh() }
    }
}

// MARK: - QuickPay

struct QuickPayView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var previousBrightness: CGFloat = UIScreen.main.brightness

    /// Whatever the first wallet exposes as a receive target.
    private var payload: String {
        container.wallets.overview?.sortedByValue.first?.id ?? "furlpay:unavailable"
    }

    var body: some View {
        VStack(spacing: 20) {
            Text("Scan to pay me")
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)

            if let image = Self.qrCode(from: payload) {
                Image(uiImage: image)
                    .interpolation(.none)          // keep the modules crisp
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 280)
                    .padding(16)
                    .background(.white)            // scanners need the light quiet zone
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                Text("Could not generate a code.")
                    .foregroundStyle(GuardianColors.negative)
            }

            Text(payload)
                .font(.caption2.monospaced())
                .foregroundStyle(GuardianColors.textTertiary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Receive")
        .navigationBarTitleDisplayMode(.inline)
        // Full brightness while shown, restored on exit — a dim OLED panel is
        // the usual reason a scanner fails to read the code.
        .onAppear {
            previousBrightness = UIScreen.main.brightness
            UIScreen.main.brightness = 1.0
        }
        .onDisappear { UIScreen.main.brightness = previousBrightness }
    }

    static func qrCode(from string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        // CIFilter emits roughly 25pt; scaling up before rasterising avoids a
        // blurry upscale in the image view.
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
