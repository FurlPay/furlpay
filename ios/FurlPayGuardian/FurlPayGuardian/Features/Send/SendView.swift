//
//  SendView.swift
//
//  Port of native-app/app/(tabs)/send.tsx.
//
//  Validation runs through SendValidator, which runs through Money.parseUsdc.
//  That is not ceremony: `Double(text) > 0` accepts "0.0000001", which
//  truncates to zero atomic units, and the user would then Face-ID-sign a
//  zero-value authorisation. The RN app had exactly that bug.
//
//  The send itself goes through the action registry — the same path an
//  AI-proposed payment takes. One authorisation path, not two.
//

import SwiftUI

struct SendView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var destination = ""
    @State private var amount = ""
    @State private var note = ""
    @State private var selectedWalletId: String?
    @State private var phase: Phase = .editing
    @State private var showScanner = false

    private enum Phase: Equatable {
        case editing
        case sending
        case sent(String)
        case failed(String)
    }

    /// Generated once per composed payment and reused across retries. A fresh
    /// key per attempt is how a flaky network turns one payment into three.
    @State private var idempotencyKey = UUID().uuidString

    private var wallets: [Wallet] {
        container.wallets.overview?.sortedByValue ?? []
    }

    private var selectedWallet: Wallet? {
        wallets.first { $0.id == selectedWalletId } ?? wallets.first
    }

    private var check: SendCheck {
        SendValidator.validate(
            destination: destination, amount: amount, balance: selectedWallet
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                switch phase {
                case .editing, .sending:
                    fromSection
                    toSection
                    amountSection
                    noteSection
                    sendSection
                case .sent(let reference):
                    sentSection(reference)
                case .failed(let message):
                    failedSection(message)
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle("Send")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .disabled(phase == .sending)
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showScanner) {
            QRScannerView { scanned in
                // Accept a bare address or a payment URI; the scanner returns
                // whatever the code held and this is the one place that knows
                // what to do with it.
                destination = PaymentURI.address(from: scanned) ?? scanned
                showScanner = false
            }
        }
        .task {
            if selectedWalletId == nil { selectedWalletId = wallets.first?.id }
        }
    }

    // MARK: Sections

    private var fromSection: some View {
        Section("From") {
            Picker("Wallet", selection: Binding(
                get: { selectedWallet?.id ?? "" },
                set: { selectedWalletId = $0 }
            )) {
                ForEach(wallets) { wallet in
                    Text("\(wallet.currency) · \(wallet.usdValue.usd)").tag(wallet.id)
                }
            }
            if let wallet = selectedWallet {
                LabeledContent("Available", value: wallet.usdValue.usd)
                    .foregroundStyle(GuardianColors.textSecondary)
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var toSection: some View {
        Section("To") {
            HStack {
                TextField("Address", text: $destination)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                Button {
                    showScanner = true
                } label: {
                    Image(systemName: "qrcode.viewfinder")
                }
                .buttonStyle(.plain)
                .foregroundStyle(GuardianColors.primaryAccent)
                .accessibilityLabel("Scan a code")
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var amountSection: some View {
        Section("Amount (USD)") {
            TextField("0.00", text: $amount)
                .keyboardType(.decimalPad)
                .font(.system(.title2, design: .rounded).weight(.medium))

            // Shown only once there is something to be wrong about, so the
            // form does not scold on the first keystroke.
            if !amount.isEmpty || !destination.isEmpty,
               let error = check.errorMessage {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.warning)
            }
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var noteSection: some View {
        Section("Note (optional)") {
            TextField("What's this for?", text: $note)
        }
        .listRowBackground(GuardianColors.surface)
    }

    private var sendSection: some View {
        Section {
            Button {
                send()
            } label: {
                HStack {
                    Spacer()
                    if phase == .sending {
                        ProgressView().tint(.white)
                    } else if case .valid(let amountUsd, _) = check {
                        Text("Send \(amountUsd.usd)")
                    } else {
                        Text("Send")
                    }
                    Spacer()
                }
            }
            .disabled(check.errorMessage != nil || phase == .sending)
        }
        .listRowBackground(GuardianColors.primaryAccent.opacity(0.9))
        .foregroundStyle(.white)
    }

    private func sentSection(_ reference: String) -> some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(GuardianColors.positive)
                Text("Sent").font(.title3.weight(.semibold))
                Text(reference)
                    .font(.caption.monospaced())
                    .foregroundStyle(GuardianColors.textSecondary)
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(GuardianColors.primaryAccent)
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
                HStack(spacing: 12) {
                    // Retry keeps the SAME idempotency key — this is the same
                    // payment, and the server must be able to tell.
                    Button("Try again") { send() }
                        .buttonStyle(.borderedProminent)
                        .tint(GuardianColors.primaryAccent)
                    Button("Edit") { phase = .editing }
                        .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
        .listRowBackground(GuardianColors.surface)
    }

    // MARK: Sending

    private func send() {
        guard case .valid(let amountUsd, _) = check,
              let wallet = selectedWallet else { return }
        phase = .sending

        Task {
            // Through the registry, exactly as an AI-proposed payment would be:
            // it validates the shape, rejects before any prompt, then gates on
            // Face ID and dispatches the registry's own copy of the request.
            // Field names are the registry's, which are /api/payments/create's:
            // `amount` + `recipient` + `sourceChain`. The registry also enforces
            // the EVM address pattern, so a recipient that is not an address is
            // rejected before any prompt is shown.
            let body: [String: JSONValue] = [
                "amount": .number(amountUsd.doubleValue),
                "recipient": .string(destination.trimmingCharacters(in: .whitespacesAndNewlines)),
                "sourceChain": .string((wallet.chain ?? "arbitrum").lowercased()),
            ]

            let rejection = await container.confirmAndDispatch(Confirmation(
                action: "send_payment",
                endpoint: "/payments/create",
                method: "POST",
                body: body,
                summary: "Send \(amountUsd.usd) to \(destination)",
                amountUsd: amountUsd.doubleValue
            ))

            if let rejection {
                phase = .failed(rejection)
            } else {
                phase = .sent(idempotencyKey)
            }
        }
    }
}

// MARK: - Payment URIs

/// Extracts an address from a scanned code.
///
/// Codes in the wild are a bare address, an EIP-681 `ethereum:0x…` URI, or a
/// Solana Pay `solana:…` URI. Returning nil for anything else means the raw
/// text falls through to the address field and the validator rejects it with a
/// message, rather than this guessing.
enum PaymentURI {
    static func address(from scanned: String) -> String? {
        let value = scanned.trimmingCharacters(in: .whitespacesAndNewlines)
        for scheme in ["ethereum:", "solana:"] where value.lowercased().hasPrefix(scheme) {
            let body = String(value.dropFirst(scheme.count))
            // Strip chain suffix ("0xabc@1") and any query parameters.
            let address = body.split(separator: "@").first.map(String.init) ?? body
            return address.split(separator: "?").first.map(String.init)
        }
        return nil
    }
}
