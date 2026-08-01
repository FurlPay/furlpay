//
//  EarnView.swift
//
//  Port of native-app/app/earn.tsx.
//
//  Yield is a claim about someone else's money, so two things are non-negotiable
//  here and both are carried over from the RN screen:
//
//   * `live == false` is SHOWN, not hidden. An indicative APY and a real one
//     are different claims and must not look alike.
//   * The provider disclosure renders verbatim. It is not ours to summarise.
//

import SwiftUI

struct EarnView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var depositing: EarnVault?

    private var repository: EarnRepository { container.earn }
    private var overview: EarnOverview { repository.overview }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !overview.live { indicativeBanner }
                if overview.summary.totalValue != nil { summaryCard }
                if let opportunity = repository.idleOpportunity { idleNudge(opportunity) }
                if !overview.positions.isEmpty { positions }
                vaults
                if !overview.disclosure.isEmpty { disclosure }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Earn")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await repository.refresh() }
        .task { await repository.refresh() }
        .sheet(item: $depositing) { vault in
            EarnDepositSheet(vault: vault)
        }
    }

    private var indicativeBanner: some View {
        Label(
            "Rates shown are indicative and not from a live position.",
            systemImage: "info.circle"
        )
        .font(.caption)
        .foregroundStyle(GuardianColors.warning)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GuardianColors.warning.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Earning").sectionTitle()
            Text((overview.summary.totalValue ?? 0).usd)
                .font(.system(size: 34, weight: .semibold, design: .rounded))
                .foregroundStyle(GuardianColors.textPrimary)
                .contentTransition(.numericText())
            HStack(spacing: 12) {
                if let earned = overview.summary.totalEarned {
                    Label("\(earned.usd) earned", systemImage: "arrow.up.right")
                        .foregroundStyle(GuardianColors.positive)
                }
                if let apy = overview.summary.blendedApy {
                    Text("\(apy.oneDecimal)% blended APY")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
            }
            .font(.caption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func idleNudge(_ opportunity: (idle: Decimal, apy: Double)) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(opportunity.idle.usd) sitting idle")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text("Up to \(opportunity.apy.oneDecimal)% APY available")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
            }
            Spacer()
            if let best = overview.vaults.max(by: { $0.netApy < $1.netApy }) {
                Button("Deposit") { depositing = best }
                    .buttonStyle(.borderedProminent)
                    .tint(GuardianColors.primaryAccent)
                    .controlSize(.small)
            }
        }
        .padding(14)
        .background(GuardianColors.primaryAccent.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var positions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your positions").sectionTitle()
            ForEach(overview.positions) { position in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(position.vaultName)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Spacer()
                        Text(position.currentValueUsd.usd)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(GuardianColors.textPrimary)
                    }
                    HStack(spacing: 10) {
                        Text("\(position.apy.oneDecimal)% APY")
                        Text("+\(position.earnedUsd.usd)")
                            .foregroundStyle(GuardianColors.positive)
                        Text("\(position.days)d")
                    }
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private var vaults: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Vaults").sectionTitle()
            ForEach(overview.vaults) { vault in
                Button {
                    depositing = vault
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(vault.name)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(GuardianColors.textPrimary)
                            HStack(spacing: 8) {
                                if let curator = vault.curator { Text(curator) }
                                if let risk = vault.risk { Text("· \(risk) risk") }
                                if let tvl = vault.tvlUsd { Text("· \(tvl.usdCompact) TVL") }
                            }
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.textTertiary)
                        }
                        Spacer()
                        Text("\(vault.netApy.oneDecimal)%")
                            .font(.headline)
                            .foregroundStyle(GuardianColors.positive)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity)
                    .background(GuardianColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var disclosure: some View {
        // Verbatim. Summarising a yield disclosure is how a marketing claim
        // gets made by accident.
        Text(overview.disclosure)
            .font(.caption2)
            .foregroundStyle(GuardianColors.textTertiary)
            .padding(.top, 8)
    }
}

// MARK: - Deposit

struct EarnDepositSheet: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    let vault: EarnVault

    @State private var amount = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(vault.name) {
                    LabeledContent("Net APY", value: "\(vault.netApy.oneDecimal)%")
                    if let risk = vault.risk { LabeledContent("Risk", value: risk) }
                    if let curator = vault.curator { LabeledContent("Curator", value: curator) }
                }
                .listRowBackground(GuardianColors.surface)

                Section("Amount (USD)") {
                    TextField("0.00", text: $amount)
                        .keyboardType(.decimalPad)
                        .font(.system(.title2, design: .rounded))
                    if !amount.isEmpty, Money.tryParseUsdc(amount) == nil {
                        Text((try? Money.parseUsdc(amount)) == nil
                             ? errorMessage(for: amount) : "")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.warning)
                    }
                }
                .listRowBackground(GuardianColors.surface)

                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                        .listRowBackground(GuardianColors.surface)
                }

                Section {
                    Button {
                        deposit()
                    } label: {
                        HStack {
                            Spacer()
                            if working { ProgressView().tint(.white) } else { Text("Deposit") }
                            Spacer()
                        }
                    }
                    .disabled(Money.tryParseUsdc(amount) == nil || working)
                }
                .listRowBackground(GuardianColors.primaryAccent.opacity(0.9))
                .foregroundStyle(.white)
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Deposit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func errorMessage(for input: String) -> String {
        do { _ = try Money.parseUsdc(input); return "" }
        catch let e as Money.AmountError { return e.message }
        catch { return "Enter a valid amount." }
    }

    private func deposit() {
        guard let atomic = Money.tryParseUsdc(amount) else { return }
        let amountUsd = Money.decimal(fromAtomic: atomic)
        working = true

        Task {
            let rejection = await container.confirmAndDispatch(Confirmation(
                action: "earn_deposit",
                endpoint: "/earn/deposit",
                method: "POST",
                body: [
                    "token": .string("USDC"),
                    "amountUsd": .number(amountUsd.doubleValue),
                ],
                summary: "Deposit \(amountUsd.usd) into \(vault.name)",
                amountUsd: amountUsd.doubleValue
            ))
            working = false
            if let rejection {
                error = rejection
            } else {
                await container.earn.refresh()
                dismiss()
            }
        }
    }
}
