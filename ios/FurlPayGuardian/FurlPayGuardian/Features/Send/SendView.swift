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
//  `/payments/create` is phase ONE of a two-phase route: it prices the payment
//  and returns EIP-712 typed data; `/payments/execute` is what settles. This
//  view therefore reports the state the server actually reached — settled, or
//  awaiting a signature — and never announces a send it cannot evidence with a
//  transaction hash.
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
    @State private var showContacts = false
    /// The address book, loaded once the screen appears so the "To" field can
    /// name a payee the moment an address is in it. Failure is silent by
    /// design: naming a contact is an enhancement to the send flow, and a book
    /// that will not load must not stop somebody paying an address they already
    /// have. What it must never do is claim an address is unknown when we
    /// simply could not check — hence `contactsLoaded`.
    @State private var contacts: [Contact] = []
    @State private var contactsLoaded = false

    enum Phase: Equatable {
        case editing
        case sending
        /// The route settled and returned a transaction hash.
        case settled(reference: String)
        /// The route created a payment intent that is waiting on a signature
        /// this app cannot produce. NOT a completed send, and never rendered
        /// as one — see `quotedSection`.
        case quoted(paymentId: String, expiresAt: String?)
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

    /// The chain of the wallet being spent from, when it declares one.
    ///
    /// Everything contact-related depends on this: which contacts can receive
    /// the payment, and whether an address in the field belongs to one of them.
    /// `nil` is a real state — the picker says so rather than showing a book
    /// filtered to nothing.
    private var chain: ContactChain? {
        selectedWallet?.chain.flatMap(ContactChain.init(rawValue:))
    }

    /// The saved contact that owns whatever is in the "To" field.
    ///
    /// Matched on the address AND the chain together, through the shared rule.
    /// Matching on the address alone would put a trusted name beside an address
    /// for a network that contact never gave one on — a false confirmation, on
    /// the one screen where a false confirmation costs money.
    ///
    /// Suppressed entirely until the book has actually loaded, so "no name
    /// shown" never silently means "we could not check".
    private var knownContact: Contact? {
        guard contactsLoaded, let chain, !destination.isEmpty else { return nil }
        return ContactRules.contact(owning: destination, on: chain, in: contacts)
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
                case .settled(let reference):
                    settledSection(reference)
                case .quoted(let paymentId, let expiresAt):
                    quotedSection(paymentId: paymentId, expiresAt: expiresAt)
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
        .sheet(isPresented: $showContacts) {
            ContactPickerView(chain: chain) { address in
                destination = address
            }
            .environment(container)
        }
        .task {
            if selectedWalletId == nil { selectedWalletId = wallets.first?.id }
            // Best-effort. A failed load leaves `contactsLoaded` false, which
            // keeps the "Saved contact" line off the screen rather than showing
            // an absence as if it were a checked negative.
            if let loaded = try? await container.api.fetchContacts() {
                contacts = loaded
                contactsLoaded = true
            }
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
            HStack(spacing: 14) {
                TextField("Address", text: $destination)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                // Contacts before the scanner: it is the only one of the two
                // that involves no transcription at all — the address was
                // checked once, when it was saved, and is not being re-entered.
                Button {
                    showContacts = true
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(GuardianColors.primaryAccent)
                .accessibilityLabel("Choose a saved contact")

                Button {
                    showScanner = true
                } label: {
                    Image(systemName: "qrcode.viewfinder")
                }
                .buttonStyle(.plain)
                .foregroundStyle(GuardianColors.primaryAccent)
                .accessibilityLabel("Scan a code")
            }

            // A name the user chose themselves is stronger confirmation than
            // any shape check: it turns "are these the right 42 characters"
            // into "is this the right person".
            if let known = knownContact {
                Label {
                    Text("Saved contact — \(known.name)")
                } icon: {
                    Image(systemName: "checkmark.seal.fill")
                }
                .font(.caption)
                .foregroundStyle(GuardianColors.primaryAccent)
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
        .foregroundStyle(GuardianColors.onPrimaryAccent)
    }

    private func settledSection(_ reference: String) -> some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(GuardianColors.positive)
                Text("Sent").font(.title3.weight(.semibold))
                // The settlement hash, not the idempotency key: a reference the
                // user can actually look up.
                Text(reference)
                    .font(.caption.monospaced())
                    .foregroundStyle(GuardianColors.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Button("Done") { dismiss() }
                    .guardianProminentButton()
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        }
        .listRowBackground(GuardianColors.surface)
    }

    /// A priced, unsigned payment intent — money has NOT moved.
    ///
    /// The Guardian app is custodial and carries no signing key, so it cannot
    /// complete the second phase itself. Saying that plainly is the only honest
    /// option: a tick and the word "Sent" over an unsigned intent is a
    /// fabricated receipt, and the user would stop chasing a payment that never
    /// happened.
    private func quotedSection(paymentId: String, expiresAt: String?) -> some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "clock.badge.exclamationmark.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(GuardianColors.warning)
                Text("Awaiting signature").font(.title3.weight(.semibold))
                Text("This payment is priced and reserved, but it has not been sent. Approve it in the FurlPay app or dashboard to sign and settle it.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(GuardianColors.textSecondary)
                Text(paymentId)
                    .font(.caption.monospaced())
                    .foregroundStyle(GuardianColors.textSecondary)
                if let expiresAt, let expiry = ISO8601DateFormatter().date(from: expiresAt) {
                    Text("Expires \(expiry.formatted(date: .omitted, time: .shortened))")
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
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
                HStack(spacing: 12) {
                    // Retry keeps the SAME idempotency key — this is the same
                    // payment, and the server must be able to tell.
                    Button("Try again") { send() }
                        .guardianProminentButton()
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

            // Read the response instead of inferring the outcome from the
            // absence of an error. `/payments/create` is the FIRST half of a
            // two-phase route: it prices the payment and returns EIP-712 typed
            // data for the payer to sign, and only `/payments/execute` moves
            // money. This screen used to treat "no rejection" as "sent", show a
            // green tick and a reference, and dismiss — for a payment that was
            // never signed, never submitted and never settled.
            let outcome = await container.confirmAndDispatchReturning(Confirmation(
                action: "send_payment",
                endpoint: "/payments/create",
                method: "POST",
                body: body,
                summary: "Send \(amountUsd.usd) to \(destination)",
                amountUsd: amountUsd.doubleValue
            ))

            switch outcome {
            case .rejected(let reason):
                phase = .failed(reason)
            case .dispatched(let response):
                phase = Self.outcomePhase(for: response)
            }
        }
    }

    /// Maps the route's own response onto a phase.
    ///
    /// A `transactionHash` is the only thing that means money moved; anything
    /// else is an intent in some pre-settlement state, and the screen says so.
    /// An unrecognised shape is NOT optimistically treated as success — the
    /// whole defect here was a success state that nothing had returned.
    static func outcomePhase(for response: JSONValue) -> Phase {
        guard case .object(let fields) = response else {
            return .failed("The server sent back a response this app could not read.")
        }
        if let hash = fields["transactionHash"]?.stringValue, !hash.isEmpty {
            return .settled(reference: hash)
        }
        if let paymentId = fields["paymentId"]?.stringValue, !paymentId.isEmpty {
            return .quoted(paymentId: paymentId, expiresAt: fields["expiresAt"]?.stringValue)
        }
        if let detail = fields["detail"]?.stringValue ?? fields["error"]?.stringValue {
            return .failed(detail)
        }
        return .failed("The server sent back a response this app could not read.")
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
