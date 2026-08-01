//
//  CardsView.swift
//
//  Freeze and unfreeze, both behind Face ID.
//
//  Note the asymmetry with the watch, which is deliberate and carried over from
//  Wear OS: the watch may freeze (a safe direction — it only ever restricts) but
//  never unfreeze (it re-enables spending, and the watch cannot prove who is
//  wearing it). Both directions are gated here because the phone can.
//

import SwiftUI

struct CardsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var pending: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(container.cards.cards) { card in
                    CardRow(
                        card: card,
                        isPending: pending == card.id,
                        onToggle: { Task { await toggle(card) } }
                    )
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(GuardianColors.negative)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Cards")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.cards.refresh() }
    }

    private func toggle(_ card: Card) async {
        error = nil
        let freezing = !card.frozen

        // The gate runs BEFORE the request is built, so a cancelled Face ID
        // leaves no trace and sends nothing.
        let reason = freezing
            ? "Confirm freezing the card ending \(card.last4)"
            : "Confirm unfreezing the card ending \(card.last4)"

        let result = await container.biometrics.authenticate(reason: reason)
        guard result.isAuthenticated else {
            if case .unavailable(let why) = result { error = why }
            return
        }

        pending = card.id
        defer { pending = nil }
        do {
            try await container.cards.setFrozen(cardId: card.id, frozen: freezing)
            await container.sync.pushAllSnapshots(from: container)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct CardRow: View {
    let card: Card
    let isPending: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: card.kind == .virtual ? "creditcard.circle" : "creditcard")
                .font(.title2)
                .foregroundStyle(card.frozen ? GuardianColors.textTertiary : GuardianColors.primaryAccent)

            VStack(alignment: .leading, spacing: 3) {
                Text(card.label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text("•••• \(card.last4)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(GuardianColors.textSecondary)
                if let limits = card.limits, let daily = limits.dailySpend {
                    Text("Daily limit \(daily.usd)")
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.textTertiary)
                }
            }

            Spacer()

            if isPending {
                ProgressView().tint(GuardianColors.primaryAccent)
            } else {
                Button(action: onToggle) {
                    Text(card.frozen ? "Unfreeze" : "Freeze")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(card.frozen
                                    ? GuardianColors.primaryAccent
                                    : GuardianColors.surfaceElevated)
                        .foregroundStyle(card.frozen ? .white : GuardianColors.textPrimary)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
