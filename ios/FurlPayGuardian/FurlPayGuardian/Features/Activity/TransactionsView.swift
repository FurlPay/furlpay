//
//  TransactionsView.swift
//
//  Ports of native-app/app/transactions.tsx and transaction/[id].tsx.
//
//  The previous iOS app had SpendingView (rollups) but no ledger. A rollup
//  answers "how much"; only a list answers "what was that charge", which is the
//  question people actually open a finance app to ask.
//

import SwiftUI

struct TransactionsView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var filter: Filter = .all
    @State private var search = ""
    @State private var selected: Transaction?

    enum Filter: String, CaseIterable, Identifiable {
        case all, out, `in`, pending
        var id: String { rawValue }

        var label: String {
            switch self {
            case .all:     "All"
            case .out:     "Sent"
            case .in:      "Received"
            case .pending: "Pending"
            }
        }
    }

    private var transactions: [Transaction] {
        container.transactions.transactions
            .filter { matches($0) }
            .sorted { $0.at > $1.at }
    }

    /// Grouped by day, newest first. A flat list of 400 rows is a scroll
    /// exercise; the date is what people navigate by.
    private var grouped: [(day: Date, items: [Transaction])] {
        let calendar = Calendar.current
        let buckets = Dictionary(grouping: transactions) {
            calendar.startOfDay(for: $0.at)
        }
        return buckets.keys.sorted(by: >).map { ($0, buckets[$0] ?? []) }
    }

    var body: some View {
        List {
            ForEach(grouped, id: \.day) { group in
                Section(group.day.dayAndMonth) {
                    ForEach(group.items) { transaction in
                        Button { selected = transaction } label: {
                            TransactionRow(transaction: transaction)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }

            if transactions.isEmpty && !container.transactions.isLoading {
                Section {
                    Text(search.isEmpty ? "No transactions yet." : "Nothing matches “\(search)”.")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search description")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Filter", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.menu)
            }
        }
        .refreshable { await container.transactions.refresh() }
        .task { await container.transactions.refresh() }
        .sheet(item: $selected) { TransactionDetailSheet(transaction: $0) }
    }

    private func matches(_ transaction: Transaction) -> Bool {
        let passesFilter: Bool
        switch filter {
        case .all:     passesFilter = true
        case .out:     passesFilter = transaction.direction == .debit
        case .in:      passesFilter = transaction.direction == .credit
        case .pending: passesFilter = transaction.status == .pending
        }
        guard passesFilter else { return false }

        guard !search.isEmpty else { return true }
        return transaction.description.localizedCaseInsensitiveContains(search)
            || (transaction.category?.localizedCaseInsensitiveContains(search) ?? false)
    }
}

struct TransactionRow: View {
    let transaction: Transaction

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: transaction.direction == .debit ? "arrow.up.right" : "arrow.down.left")
                .font(.caption.weight(.bold))
                .frame(width: 28, height: 28)
                .background(iconTint.opacity(0.15))
                .foregroundStyle(iconTint)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.description)
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(transaction.at.shortTime)
                    if let category = transaction.category { Text("· \(category)") }
                    if transaction.status != .settled {
                        Text("· \(transaction.status.rawValue.capitalized)")
                            .foregroundStyle(statusTint)
                    }
                }
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
            }

            Spacer()

            Text(signedAmount)
                .font(.subheadline.weight(.medium).monospacedDigit())
                .foregroundStyle(
                    transaction.direction == .credit
                        ? GuardianColors.positive : GuardianColors.textPrimary
                )
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(transaction.description), \(signedAmount), \(transaction.status.rawValue)"
        )
    }

    private var signedAmount: String {
        (transaction.direction == .debit ? "−" : "+") + transaction.amountUsd.usd
    }

    private var iconTint: Color {
        transaction.status == .failed
            ? GuardianColors.negative
            : (transaction.direction == .credit ? GuardianColors.positive : GuardianColors.primaryAccent)
    }

    private var statusTint: Color {
        switch transaction.status {
        case .pending: GuardianColors.warning
        case .failed:  GuardianColors.negative
        default:       GuardianColors.textTertiary
        }
    }
}

struct TransactionDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let transaction: Transaction

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 6) {
                        Text((transaction.direction == .debit ? "−" : "+") + transaction.amountUsd.usd)
                            .font(.system(size: 36, weight: .semibold, design: .rounded))
                            .foregroundStyle(
                                transaction.direction == .credit
                                    ? GuardianColors.positive : GuardianColors.textPrimary
                            )
                        Text(transaction.description)
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .listRowBackground(GuardianColors.surface)

                Section {
                    row("Status", transaction.status.rawValue.capitalized)
                    row("Date", transaction.at.formatted(date: .abbreviated, time: .shortened))
                    if let category = transaction.category { row("Category", category) }
                    row("Direction", transaction.direction == .debit ? "Sent" : "Received")
                    row("Reference", transaction.id)
                }
                .listRowBackground(GuardianColors.surface)
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Transaction")
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
                .font(key == "Reference" ? .caption.monospaced() : .subheadline)
                .foregroundStyle(GuardianColors.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}
