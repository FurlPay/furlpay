//
//  BankingView.swift
//
//  Port of native-app/app/banking.tsx — linked bank accounts and their details.
//
//  Account and routing numbers arrive ALREADY MASKED from the server, the same
//  rule the passport vault follows: the client is never given a full one, so
//  there is nothing here to leak, log or screenshot. What the user needs in
//  order to receive a transfer is generated server-side and shared through the
//  system share sheet rather than assembled from parts held in memory.
//
//  Access is gated on Face ID for the same reason the document wallet is:
//  reading account details is sensitive-data ACCESS, not an approval, so the
//  gate applies regardless of any "biometric approvals" preference.
//

import SwiftUI

struct BankingView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.scenePhase) private var scenePhase

    @State private var unlocked = false
    @State private var unlockFailed = false
    @State private var selected: BankAccount?

    private var repository: BankingRepository { container.banking }

    var body: some View {
        Group {
            if unlocked {
                content
            } else {
                LockedVaultView(failed: unlockFailed) { await unlock() }
            }
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Banking")
        .navigationBarTitleDisplayMode(.inline)
        .task { await unlock() }
        // Re-arms on background, like the document wallet.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { unlocked = false }
        }
        .sheet(item: $selected) { account in
            BankAccountSheet(account: account)
        }
    }

    private func unlock() async {
        guard !unlocked else { return }
        let ok = await container.biometrics.authenticate(
            reason: "Unlock your bank details"
        ).isAuthenticated
        unlocked = ok
        unlockFailed = !ok
        if ok { await repository.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                balances
                accounts
                footnote
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .refreshable { await repository.refresh() }
    }

    @ViewBuilder
    private var balances: some View {
        if repository.overview.balanceUsd != nil || repository.overview.pendingUsd != nil {
            HStack(spacing: 12) {
                if let balance = repository.overview.balanceUsd {
                    balanceCard("Available", balance, GuardianColors.textPrimary)
                }
                if let pending = repository.overview.pendingUsd, pending > 0 {
                    balanceCard("Pending", pending, GuardianColors.warning)
                }
            }
        }
    }

    private func balanceCard(_ label: String, _ value: Decimal, _ colour: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(GuardianColors.textSecondary)
            Text(value.usd)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .foregroundStyle(colour)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var accounts: some View {
        if repository.overview.accounts.isEmpty && !repository.isLoading {
            VStack(spacing: 10) {
                Image(systemName: "building.columns")
                    .font(.system(size: 40))
                    .foregroundStyle(GuardianColors.textTertiary)
                Text("No bank accounts linked")
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Accounts").sectionTitle()
                ForEach(repository.overview.accounts) { account in
                    Button { selected = account } label: { BankAccountRow(account: account) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private var footnote: some View {
        Text("Account numbers are masked. FurlPay never stores a full account number on this device.")
            .font(.caption2)
            .foregroundStyle(GuardianColors.textTertiary)
            .padding(.top, 8)
    }
}

struct BankAccountRow: View {
    let account: BankAccount

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(account.label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
                HStack(spacing: 6) {
                    if let bank = account.bankName { Text(bank) }
                    Text("· \(account.currency)")
                }
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(account.accountNumberMasked ?? account.ibanMasked ?? "••••")
                    .font(.caption.monospaced())
                    .foregroundStyle(GuardianColors.textSecondary)
                statusChip
            }
        }
        .padding(14)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var statusChip: some View {
        Text(account.status.uppercased())
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(statusColour.opacity(0.16))
            .foregroundStyle(statusColour)
            .clipShape(Capsule())
    }

    private var statusColour: Color {
        switch account.status.lowercased() {
        case "active", "verified": GuardianColors.positive
        case "pending":            GuardianColors.warning
        default:                   GuardianColors.negative
        }
    }
}

// MARK: - Detail

struct BankAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    let account: BankAccount

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Label", account.label)
                    if let bank = account.bankName { row("Bank", bank) }
                    row("Currency", account.currency)
                    row("Status", account.status.capitalized)
                }
                Section("Details") {
                    // Every one of these is masked server-side. There is no
                    // "reveal" control because the client does not hold the
                    // full value to reveal.
                    if let number = account.accountNumberMasked { row("Account", number) }
                    if let routing = account.routingNumberMasked { row("Routing", routing) }
                    if let iban = account.ibanMasked { row("IBAN", iban) }
                    if let bic = account.bicMasked { row("BIC", bic) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key).foregroundStyle(GuardianColors.textSecondary)
            Spacer()
            Text(value)
                .font(key == "Label" || key == "Bank" ? .subheadline : .subheadline.monospaced())
                .foregroundStyle(GuardianColors.textPrimary)
        }
        .font(.subheadline)
        .listRowBackground(GuardianColors.surface)
    }
}
