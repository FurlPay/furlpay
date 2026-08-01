//
//  BillsView.swift
//
//  Port of native-app/app/bills.tsx — bills plus the off-ramp panel that
//  screen carries.
//

import SwiftUI

struct BillsView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var paying: Bill?

    private var repository: BillsRepository { container.bills }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !repository.dueSoon.isEmpty { dueSoonBanner }
                billList
                OffRampPanel()
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Bills")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await repository.refresh() }
        .task { await repository.refresh() }
        .sheet(item: $paying) { bill in PayBillSheet(bill: bill) }
    }

    private var dueSoonBanner: some View {
        let count = repository.dueSoon.count
        return Label(
            "\(count) bill\(count == 1 ? "" : "s") due within a week",
            systemImage: "calendar.badge.exclamationmark"
        )
        .font(.caption)
        .foregroundStyle(GuardianColors.warning)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GuardianColors.warning.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private var billList: some View {
        if repository.bills.isEmpty && !repository.isLoading {
            Text("No bills tracked yet.")
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Upcoming").sectionTitle()
                ForEach(repository.sorted) { bill in
                    Button { paying = bill } label: { BillRow(bill: bill) }
                        .buttonStyle(.plain)
                }
            }
        }
    }
}

struct BillRow: View {
    let bill: Bill

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(bill.provider)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(GuardianColors.textPrimary)
                HStack(spacing: 6) {
                    Text(bill.categoryLabel)
                    if bill.autopay {
                        Text("· Autopay")
                            .foregroundStyle(GuardianColors.primaryAccent)
                    }
                }
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(bill.balanceDue.usd)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text(dueLabel)
                    .font(.caption2)
                    .foregroundStyle(dueColour)
            }
        }
        .padding(14)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var dueLabel: String {
        guard let days = bill.daysUntilDue() else { return "Due \(bill.dueDate)" }
        if days < 0 { return "\(-days)d overdue" }
        if days == 0 { return "Due today" }
        return "Due in \(days)d"
    }

    private var dueColour: Color {
        guard let days = bill.daysUntilDue() else { return GuardianColors.textTertiary }
        if days < 0 { return GuardianColors.negative }
        if days <= 3 { return GuardianColors.warning }
        return GuardianColors.textTertiary
    }
}

// MARK: - Pay

struct PayBillSheet: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    let bill: Bill

    @State private var amount: String = ""
    @State private var working = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        NavigationStack {
            Form {
                Section(bill.provider) {
                    LabeledContent("Balance due", value: bill.balanceDue.usd)
                    LabeledContent("Category", value: bill.categoryLabel)
                    LabeledContent("Due", value: bill.dueDate)
                }
                .listRowBackground(GuardianColors.surface)

                Section("Pay") {
                    TextField("0.00", text: $amount)
                        .keyboardType(.decimalPad)
                        .font(.system(.title2, design: .rounded))
                    Button("Pay full balance") {
                        amount = Money.formatAtomic(
                            Int64((bill.balanceDue * 1_000_000).doubleValue.rounded())
                        )
                    }
                    .font(.caption)
                }
                .listRowBackground(GuardianColors.surface)

                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                        .listRowBackground(GuardianColors.surface)
                }

                Section {
                    Button {
                        pay()
                    } label: {
                        HStack {
                            Spacer()
                            if working { ProgressView().tint(.white) } else { Text("Pay") }
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
            .navigationTitle("Pay bill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
        .task { if amount.isEmpty { amount = Money.formatAtomic(Int64((bill.balanceDue * 1_000_000).doubleValue.rounded())) } }
    }

    private func pay() {
        guard let atomic = Money.tryParseUsdc(amount) else { return }
        let amountUsd = Money.decimal(fromAtomic: atomic)
        working = true

        Task {
            // Bills have no registry action of their own, so the biometric gate
            // is explicit here rather than implied by confirmAndDispatch. It is
            // still money leaving the account and must be confirmed.
            guard await container.biometrics.authenticate(
                reason: "Pay \(amountUsd.usd) to \(bill.provider)"
            ).isAuthenticated else {
                working = false
                error = "Not confirmed."
                return
            }
            do {
                try await container.bills.pay(
                    bill, amountUsd: amountUsd, idempotencyKey: idempotencyKey
                )
                await container.wallets.refresh()
                dismiss()
            } catch {
                self.error = "That payment couldn't be completed."
            }
            working = false
        }
    }
}

// MARK: - Off-ramp

/// Cash out to a bank account in another currency. Quote first, then execute —
/// the user must see the rate and the fee before committing, which is the whole
/// point of a two-step flow for FX.
struct OffRampPanel: View {
    @Environment(ServiceContainer.self) private var container

    @State private var amount = "500"
    @State private var currency = "EUR"
    @State private var quoting = false
    @State private var quote: FxQuote?
    @State private var error: String?

    private let currencies = ["EUR", "GBP", "INR", "BRL", "USD"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cash out").sectionTitle()

            HStack(spacing: 10) {
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                    .padding(12)
                    .background(GuardianColors.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Picker("To", selection: $currency) {
                    ForEach(currencies, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(GuardianColors.primaryAccent)
            }
            .onChange(of: amount) { _, _ in quote = nil }
            .onChange(of: currency) { _, _ in quote = nil }

            if let quote {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(quote.amountTo.quantity) \(quote.to)")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(GuardianColors.textPrimary)
                    Text("\(quote.rail) · \(quote.feePct.oneDecimal)% fee · rate \(quote.midMarketRate.quantity)")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textSecondary)
                    if quote.savingsVsCompetitorPct > 0 {
                        Text("\(quote.savingsVsCompetitorPct.oneDecimal)% cheaper than a typical bank transfer")
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.positive)
                    }
                }
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(GuardianColors.negative)
            }

            Button {
                getQuote()
            } label: {
                if quoting {
                    HStack { ProgressView().controlSize(.small); Text("Getting rate…") }
                } else {
                    Text(quote == nil ? "Get rate" : "Refresh rate")
                }
            }
            .buttonStyle(.bordered)
            .tint(GuardianColors.primaryAccent)
            .disabled(Money.tryParseUsdc(amount) == nil || quoting)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func getQuote() {
        guard let atomic = Money.tryParseUsdc(amount) else { return }
        quoting = true
        error = nil
        Task {
            do {
                quote = try await container.offRamp.requestQuote(
                    amountUsd: Money.decimal(fromAtomic: atomic), to: currency
                )
            } catch {
                self.error = "Couldn't get a rate right now."
            }
            quoting = false
        }
    }
}
