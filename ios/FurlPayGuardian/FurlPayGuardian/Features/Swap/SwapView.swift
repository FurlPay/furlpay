//
//  SwapView.swift
//
//  Port of native-app/app/swap.tsx.
//
//  THE INVARIANT THIS SCREEN EXISTS TO PROTECT: the quote the user approves is
//  the quote that executes. `SwapRepository.execute` takes a `SwapQuote`, not a
//  pair and an amount, so there is no code path that can re-quote at execute
//  time and fill at a worse price than the one on screen. The server issues the
//  quoteId single-use for the same reason.
//
//  Slippage and price impact are surfaced BEFORE the confirm control, and a
//  quote past its expiry disables it. A user should never be asked to authorise
//  a number that is no longer true.
//

import SwiftUI

struct SwapView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var fromAsset = "USDC"
    @State private var toAsset = "ETH"
    @State private var amount = ""
    @State private var phase: Phase = .editing
    @State private var quoteError: String?
    @State private var now = Date()

    /// One key per swap, held across retries of that swap.
    @State private var idempotencyKey = UUID().uuidString

    private enum Phase: Equatable {
        case editing
        case executing
        case done(SwapExecution)
        case failed(String)
    }

    /// Above this the confirm control is blocked outright rather than warned
    /// about. A 5% slippage on a swap is not a preference, it is a mistake.
    private let maxSlippagePct = 5.0

    private var repository: SwapRepository { container.swaps }

    private var assets: [String] {
        let held = container.wallets.overview?.wallets.map(\.currency) ?? []
        // Union, so a user can swap INTO something they do not yet hold.
        return Array(Set(held + ["USDC", "USDT", "ETH", "SOL", "BTC"])).sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                switch phase {
                case .editing, .executing:
                    pairSection
                    amountSection
                    quoteSection
                    confirmSection
                case .done(let execution):
                    doneSection(execution)
                case .failed(let message):
                    failedSection(message)
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Swap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .disabled(phase == .executing)
        }
        .preferredColorScheme(.dark)
        // Drives the expiry countdown. A quote that silently goes stale while
        // the user reads it is the failure mode this prevents.
        .task {
            while !Task.isCancelled {
                now = Date()
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .onDisappear { repository.clearQuote() }
    }

    // MARK: Sections

    private var pairSection: some View {
        Section {
            Picker("From", selection: $fromAsset) {
                ForEach(assets, id: \.self) { Text($0).tag($0) }
            }
            Picker("To", selection: $toAsset) {
                ForEach(assets.filter { $0 != fromAsset }, id: \.self) { Text($0).tag($0) }
            }
            Button {
                swap(&fromAsset, &toAsset)
                repository.clearQuote()
            } label: {
                Label("Swap direction", systemImage: "arrow.up.arrow.down")
            }
            .foregroundStyle(GuardianColors.primaryAccent)
        }
        .listRowBackground(GuardianColors.surface)
        .onChange(of: fromAsset) { _, _ in repository.clearQuote() }
        .onChange(of: toAsset) { _, _ in repository.clearQuote() }
    }

    private var amountSection: some View {
        Section("Amount (USD)") {
            TextField("0.00", text: $amount)
                .keyboardType(.decimalPad)
                .font(.system(.title2, design: .rounded).weight(.medium))
                .onChange(of: amount) { _, _ in repository.clearQuote() }

            Button {
                requestQuote()
            } label: {
                if repository.isQuoting {
                    HStack { ProgressView().controlSize(.small); Text("Finding the best route…") }
                } else {
                    Text("Get quote")
                }
            }
            .disabled(Money.tryParseUsdc(amount) == nil || repository.isQuoting)

            if let quoteError {
                Label(quoteError, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.warning)
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    @ViewBuilder
    private var quoteSection: some View {
        if let quote = repository.quote {
            Section("Quote") {
                LabeledContent("You receive") {
                    Text("\(quote.amountOut.quantity) \(quote.toAsset)")
                        .font(.headline)
                        .foregroundStyle(GuardianColors.textPrimary)
                }
                if let rate = quote.rate {
                    LabeledContent("Rate", value: "1 \(quote.fromAsset) = \(rate.quantity) \(quote.toAsset)")
                }
                if let fee = quote.feeUsd {
                    LabeledContent("Fee", value: fee.usd)
                }

                LabeledContent("Slippage") {
                    Text(quote.slippagePct.signedPercent)
                        .foregroundStyle(
                            quote.slippagePct > maxSlippagePct
                                ? GuardianColors.negative : GuardianColors.textSecondary
                        )
                }
                if let impact = quote.priceImpactPct, abs(impact) >= 1 {
                    // Surfaced only when it is material. A 0.02% impact line
                    // teaches people to ignore the row that matters.
                    Label(
                        "Price impact \(impact.signedPercent)",
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(.caption)
                    .foregroundStyle(GuardianColors.warning)
                }

                if let expiry = quote.expiresAt {
                    let remaining = Int(expiry.timeIntervalSince(now))
                    if remaining > 0 {
                        LabeledContent("Expires in", value: "\(remaining)s")
                            .foregroundStyle(GuardianColors.textSecondary)
                    } else {
                        Label("Quote expired", systemImage: "clock.badge.xmark")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.negative)
                    }
                }
            }
            .listRowBackground(GuardianColors.surface)
        }
    }

    @ViewBuilder
    private var confirmSection: some View {
        if let quote = repository.quote {
            let expired = quote.isExpired(at: now)
            let tooMuchSlippage = quote.slippagePct > maxSlippagePct

            Section {
                Button {
                    execute(quote)
                } label: {
                    HStack {
                        Spacer()
                        if phase == .executing {
                            ProgressView().tint(.white)
                        } else if expired {
                            Text("Get a new quote")
                        } else {
                            Text("Swap for \(quote.amountOut.quantity) \(quote.toAsset)")
                        }
                        Spacer()
                    }
                }
                .disabled(expired || tooMuchSlippage || phase == .executing)

                if tooMuchSlippage {
                    Text("Slippage above \(Int(maxSlippagePct))% — this route isn't safe to take.")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.negative)
                }
            }
            .listRowBackground(
                expired || tooMuchSlippage
                    ? GuardianColors.surface
                    : GuardianColors.primaryAccent.opacity(0.9)
            )
            .foregroundStyle(expired || tooMuchSlippage ? GuardianColors.textSecondary : .white)
        }
    }

    private func doneSection(_ execution: SwapExecution) -> some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(GuardianColors.positive)
                Text("Swapped").font(.title3.weight(.semibold))
                Text("\(execution.amountIn.quantity) \(execution.fromAsset) → \(execution.amountOut.quantity) \(execution.toAsset)")
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textSecondary)
                Button("Done") { dismiss() }
                    .guardianProminentButton()
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        }
        .listRowBackground(GuardianColors.surface)
    }

    private func failedSection(_ message: String) -> some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(GuardianColors.negative)
                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(GuardianColors.textSecondary)
                // No "try again" here. The quote is consumed and the price has
                // moved; the honest next step is a fresh quote.
                Button("Start over") {
                    repository.clearQuote()
                    idempotencyKey = UUID().uuidString
                    phase = .editing
                }
                .guardianProminentButton()
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
        .listRowBackground(GuardianColors.surface)
    }

    // MARK: Actions

    private func requestQuote() {
        guard let atomic = Money.tryParseUsdc(amount) else { return }
        quoteError = nil
        Task {
            do {
                _ = try await repository.requestQuote(
                    from: fromAsset, to: toAsset,
                    amountUsd: Money.decimal(fromAtomic: atomic)
                )
            } catch {
                quoteError = "Couldn't get a quote right now."
            }
        }
    }

    private func execute(_ quote: SwapQuote) {
        phase = .executing
        Task {
            // Through the registry, like every other money-moving action. The
            // quoteId is the only field the server acts on; the pair and amount
            // are echoed so the confirmation card has something to show. The
            // registry injects `execute: true` itself — without it /api/swaps
            // takes the quote branch and returns a fresh price instead of
            // settling the one the user approved.
            let rejection = await container.confirmAndDispatch(Confirmation(
                action: "execute_swap",
                endpoint: "/swaps",
                method: "POST",
                body: [
                    "quoteId": .string(quote.quoteId),
                    "fromToken": .string(quote.fromAsset),
                    "toToken": .string(quote.toAsset),
                    "amountIn": .number(quote.amountIn.doubleValue),
                ],
                summary: "Swap \(quote.amountIn.quantity) \(quote.fromAsset) for "
                    + "\(quote.amountOut.quantity) \(quote.toAsset)",
                amountUsd: quote.amountIn.doubleValue
            ))

            if let rejection {
                phase = .failed(rejection)
                return
            }
            phase = .done(SwapExecution(
                id: idempotencyKey, status: "submitted",
                fromAsset: quote.fromAsset, toAsset: quote.toAsset,
                amountIn: quote.amountIn, amountOut: quote.amountOut, txHash: nil
            ))
            repository.clearQuote()
            await container.refreshAll()
        }
    }
}
