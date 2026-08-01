//
//  TapToPayView.swift
//
//  The merchant terminal. One number, one action.
//
//  This screen is used standing up, at a counter, with a customer waiting. That
//  constrains it more than any style guide: the amount is the largest thing on
//  screen, the keypad is thumb-reachable, and every state change is legible from
//  arm's length. Nothing here scrolls.
//

import SwiftUI

public struct TapToPayView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var service: TapToPayService?
    @State private var entry = AmountEntry()
    /// One key per charge, reused across retries of THAT charge. A new sale
    /// gets a new one — see `startNewSale`.
    @State private var idempotencyKey = UUID().uuidString

    public init() {}

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                amountDisplay
                Spacer(minLength: 8)
                content
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Take Payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("How to tap", systemImage: "questionmark.circle") {
                        Task { await service?.showHowToTapIfNeeded(force: true) }
                    }
                    .labelStyle(.iconOnly)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            if service == nil { service = TapToPayService(container: container) }
            await service?.refreshAvailability()
        }
    }

    // MARK: Amount

    private var amountDisplay: some View {
        VStack(spacing: 6) {
            Text(entry.formatted)
                .font(.system(size: 56, weight: .semibold, design: .rounded))
                .foregroundStyle(
                    entry.amount > 0 ? GuardianColors.textPrimary : GuardianColors.textTertiary
                )
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.15), value: entry.amount)
                .minimumScaleFactor(0.5)
                .lineLimit(1)

            if case .unavailable(let reason) = service?.availability ?? .unavailable(.noProvider) {
                Label(reason.title, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.warning)
            }
        }
        .padding(.top, 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Amount \(entry.formatted)")
    }

    // MARK: Phase-driven body

    @ViewBuilder
    private var content: some View {
        switch service?.phase ?? .idle {
        case .idle:
            keypad
            chargeButton

        case .preparing:
            statusPanel(
                icon: "hourglass", tint: GuardianColors.textSecondary,
                title: "Getting ready", detail: nil, pulsing: true
            )

        case .waitingForTap:
            statusPanel(
                icon: "wave.3.right", tint: GuardianColors.primaryAccent,
                title: "Ask the customer to tap",
                detail: "Hold their iPhone, Watch or card to the top of your iPhone.",
                pulsing: true
            )

        case .authorising:
            statusPanel(
                icon: "lock.shield", tint: GuardianColors.primaryAccent,
                title: "Authorising", detail: "Don't move the card.", pulsing: true
            )

        case .succeeded(let result):
            VStack(spacing: 16) {
                statusPanel(
                    icon: "checkmark.circle.fill", tint: GuardianColors.positive,
                    title: "Paid \(result.amount.usd)",
                    detail: result.cardDescription, pulsing: false
                )
                Button("New sale") { startNewSale() }
                    .buttonStyle(.borderedProminent)
                    .tint(GuardianColors.primaryAccent)
                    .controlSize(.large)
            }

        case .failed(let message, let recoverable):
            VStack(spacing: 16) {
                statusPanel(
                    icon: "exclamationmark.triangle.fill", tint: GuardianColors.negative,
                    title: "Not taken", detail: message, pulsing: false
                )
                HStack(spacing: 12) {
                    // Retry keeps the SAME idempotency key: this is the same
                    // sale, and the server must be able to tell.
                    if recoverable {
                        Button("Try again") { charge() }
                            .buttonStyle(.borderedProminent)
                            .tint(GuardianColors.primaryAccent)
                    }
                    Button("New sale") { startNewSale() }
                        .buttonStyle(.bordered)
                }
                .controlSize(.large)
            }
        }
    }

    private func statusPanel(
        icon: String, tint: Color, title: String, detail: String?, pulsing: Bool
    ) -> some View {
        VStack(spacing: 14) {
            PulsingGlyph(systemName: icon, tint: tint, active: pulsing)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Keypad

    private var keypad: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(spacing: 10), count: 3), spacing: 10) {
            ForEach(keys, id: \.self) { key in
                Button {
                    entry.press(key)
                } label: {
                    Group {
                        if key == "⌫" {
                            Image(systemName: "delete.backward")
                        } else {
                            Text(key)
                        }
                    }
                    .font(.title2.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 56)
                }
                .foregroundStyle(GuardianColors.textPrimary)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityLabel(key == "⌫" ? "Delete" : key)
            }
        }
    }

    private var chargeButton: some View {
        Button {
            charge()
        } label: {
            Text(entry.amount > 0 ? "Charge \(entry.amount.usd)" : "Enter an amount")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
        }
        .buttonStyle(.borderedProminent)
        .tint(GuardianColors.primaryAccent)
        .disabled(!(service?.availability.isAvailable ?? false) || entry.amount <= 0)
        .padding(.top, 12)
    }

    // MARK: Actions

    private func charge() {
        guard let service else { return }
        Task {
            await service.collect(TapToPayCharge(
                amount: entry.amount,
                reference: "FurlPay sale",
                idempotencyKey: idempotencyKey
            ))
        }
    }

    private func startNewSale() {
        entry = AmountEntry()
        idempotencyKey = UUID().uuidString
        service?.reset()
    }
}

// MARK: - Amount entry

/// Till-style entry: digits fill from the right, so "1", "2", "5" reads $1.25.
///
/// Kept as a value type with no formatter state so it is testable without a
/// view — the arithmetic here decides what a customer is charged.
struct AmountEntry: Equatable {
    private(set) var minorUnits: Int = 0

    var amount: Decimal { Decimal(minorUnits) / 100 }

    var formatted: String { amount.usd }

    mutating func press(_ key: String) {
        switch key {
        case "⌫":
            minorUnits /= 10
        case ".":
            // No-op. In till entry the decimal point is implied by position;
            // accepting it would let "1.2.5" happen.
            break
        default:
            guard let digit = Int(key) else { return }
            // Ceiling stops a leaning thumb from producing an eight-figure
            // charge, and matches TapToPayCharge.isValid.
            let next = minorUnits * 10 + digit
            guard next <= 1_000_000 else { return }
            minorUnits = next
        }
    }
}

// MARK: - Bits

struct PulsingGlyph: View {
    let systemName: String
    let tint: Color
    let active: Bool

    @State private var pulsing = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 46))
            .foregroundStyle(tint)
            .scaleEffect(active && pulsing ? 1.10 : 1.0)
            .opacity(active && pulsing ? 0.75 : 1.0)
            // Breathe, never strobe — same rule as the watch skeleton.
            .animation(
                active
                    ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
                    : .default,
                value: pulsing
            )
            .onAppear { pulsing = true }
    }
}

/// Merchant education for iOS 16.4–17, where Apple's ProximityReaderDiscovery
/// content API does not exist but Apple's requirement to educate still does.
struct HowToTapFallbackView: View {
    @Environment(\.dismiss) private var dismiss

    private let steps: [(String, String)] = [
        ("1.circle.fill", "Enter the amount and tap Charge."),
        ("2.circle.fill", "Ask the customer to hold their iPhone, Apple Watch, or contactless card to the top of your iPhone."),
        ("3.circle.fill", "Hold still until you see the checkmark."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("How to take a payment")
                .font(.title2.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)

            ForEach(steps, id: \.0) { icon, text in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: icon)
                        .font(.title3)
                        .foregroundStyle(GuardianColors.primaryAccent)
                    Text(text)
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer()

            Button("Got it") { dismiss() }
                .buttonStyle(.borderedProminent)
                .tint(GuardianColors.primaryAccent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GuardianColors.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
