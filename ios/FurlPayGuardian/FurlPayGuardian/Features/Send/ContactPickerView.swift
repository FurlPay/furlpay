//
//  ContactPickerView.swift
//
//  Pick a payee from the address book, mid-send.
//
//  TWO STAGES, AND THE SECOND IS NOT OPTIONAL. A contact can hold several
//  addresses on the same network — an exchange deposit address and a personal
//  wallet — and silently taking the default would mean the user chose "Alice"
//  and paid an address they never looked at. One matching address resolves
//  immediately; more than one opens the address list first. Same shape as
//  Tangem's MatchedContact → AddressSelectorBottomSheet, and as the Android
//  app's ContactPickerSheet.
//
//  THE LIST IS FILTERED TO THE CHAIN BEING PAID, and contacts with nothing
//  payable there are removed rather than shown disabled — offering one invites
//  exactly the mistake the address book exists to prevent. When the wallet's
//  chain is unknown the sheet says so instead of showing an unfiltered book.
//
//  ALL OF THE LOGIC IS IN ContactRules. Nothing in this file decides which
//  address is preferred or whether a contact can receive on a chain; those are
//  the shared rules, and reimplementing one here is how the three platforms
//  start disagreeing.
//

import SwiftUI

struct ContactPickerView: View {
    /// The chain being paid, when the selected wallet declares one.
    let chain: ContactChain?
    let onPick: (String) -> Void

    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var contacts: [Contact] = []
    @State private var query = ""
    @State private var loadState: LoadState = .loading
    /// The contact whose addresses are being chosen between. Non-nil only in
    /// stage two.
    @State private var expanded: Contact?

    private enum LoadState: Equatable {
        case loading
        case loaded
        /// The book could not be read. Deliberately NOT the same as an empty
        /// book: one invites you to add someone, the other means we do not know
        /// what is in it — and on a payment screen that is a reason to stop.
        case failed(String)
    }

    private var visible: [Contact] {
        guard let chain else { return [] }
        return ContactRules.search(
            ContactRules.contacts(contacts, payableOn: chain),
            query: query
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if let expanded {
                    addressList(for: expanded)
                } else {
                    contactList
                }
            }
            .scrollContentBackground(.hidden)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationTitle(expanded.map { "Pay \($0.name)" } ?? "Choose a contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(expanded == nil ? "Cancel" : "Back") {
                        if expanded == nil { dismiss() } else { expanded = nil }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    // MARK: Stage one — contacts

    @ViewBuilder
    private var contactList: some View {
        List {
            switch loadState {
            case .loading:
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading your address book…")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)

            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(GuardianColors.warning)
                    .listRowBackground(GuardianColors.surface)
                Button("Try again") { Task { await load() } }
                    .listRowBackground(GuardianColors.surface)

            case .loaded:
                if chain == nil {
                    // The wallet did not declare a chain, so there is no honest
                    // way to say which contacts can receive this payment.
                    Text("Choose what you're paying with first — the network decides which contacts can receive it.")
                        .font(.footnote)
                        .foregroundStyle(GuardianColors.textSecondary)
                        .listRowBackground(GuardianColors.surface)
                } else if visible.isEmpty {
                    Text(
                        query.isEmpty
                            ? "None of your contacts has an address that can receive \(chain?.displayName ?? "") payments yet."
                            : "No saved contact matches that name or address."
                    )
                    .font(.footnote)
                    .foregroundStyle(GuardianColors.textSecondary)
                    .listRowBackground(GuardianColors.surface)
                } else {
                    ForEach(visible) { contact in
                        Button { choose(contact) } label: { row(for: contact) }
                            .buttonStyle(.plain)
                            .listRowBackground(GuardianColors.surface)
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Search name or address")
    }

    private func row(for contact: Contact) -> some View {
        HStack(spacing: 12) {
            avatar(for: contact)
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                // Never with the ends emphasised — that habit is precisely what
                // address poisoning survives. The full address is checked on the
                // send screen, grouped; this is a reminder of which one it is.
                Text(subtitle(for: contact))
                    .font(.caption.monospaced())
                    .foregroundStyle(GuardianColors.textSecondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(contact.name)\(contact.isFavorite ? ", favourite" : ""), \(contact.addresses.count) \(contact.addresses.count == 1 ? "address" : "addresses")"
        )
    }

    private func subtitle(for contact: Contact) -> String {
        guard let primary = contact.addresses.first(where: \.isDefault) ?? contact.addresses.first else {
            return "No addresses yet"
        }
        let extra = contact.addresses.count - 1
        let short = shorten(primary.address)
        return extra > 0 ? "\(short) +\(extra) more" : short
    }

    private func avatar(for contact: Contact) -> some View {
        ZStack {
            Circle()
                .fill(Color(hex: contact.avatarColor) ?? GuardianColors.primaryAccent)
                .frame(width: 38, height: 38)
            Text(ContactRules.initial(of: contact.name))
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(.white)
            if contact.isFavorite {
                Image(systemName: "star.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(GuardianColors.warning)
                    .offset(x: 14, y: 14)
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: Stage two — which address

    @ViewBuilder
    private func addressList(for contact: Contact) -> some View {
        // Stage two is only reachable through `choose`, which requires a chain.
        // Substituting a default here rather than returning nothing would be
        // the cross-family fallback rule 3 forbids, arriving through the back
        // door: it would list addresses for a network the user is not paying.
        if let chain {
            List {
                Section {
                    ForEach(ContactRules.addresses(of: contact, on: chain)) { entry in
                        Button {
                            onPick(entry.address)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 8) {
                                    Text(entry.label ?? "Address")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(GuardianColors.textPrimary)
                                    if entry.isDefault {
                                        Text("PREFERRED")
                                            .font(.system(size: 9).weight(.heavy))
                                            .foregroundStyle(GuardianColors.primaryAccent)
                                    }
                                }
                                Text(shorten(entry.address, lead: 10))
                                    .font(.caption.monospaced())
                                    .foregroundStyle(GuardianColors.textSecondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(GuardianColors.surface)
                    }
                } header: {
                    Text("\(contact.name) has more than one address on \(chain.displayName). Choose which one to pay.")
                        .textCase(nil)
                }
            }
        }
    }

    // MARK: Behaviour

    private func choose(_ contact: Contact) {
        guard let chain else { return }
        let matching = ContactRules.addresses(of: contact, on: chain)
        if matching.count > 1 {
            expanded = contact
            return
        }
        // Through the shared helper rather than `matching.first`: they agree
        // when there is one address, and the rule for which is preferred then
        // lives in exactly one place.
        guard let chosen = ContactRules.defaultAddress(of: contact, on: chain) else { return }
        onPick(chosen.address)
        dismiss()
    }

    private func load() async {
        loadState = .loading
        do {
            contacts = try await container.api.fetchContacts()
            loadState = .loaded
        } catch {
            contacts = []
            loadState = .failed(
                "Couldn't load your address book. Your saved contacts are unchanged."
            )
        }
    }

    private func shorten(_ address: String, lead: Int = 8) -> String {
        guard address.count > lead + 6 else { return address }
        return "\(address.prefix(lead))…\(address.suffix(4))"
    }
}

/// Parses the palette hex the server constrains `avatarColor` to.
///
/// Returns nil rather than a default on anything unexpected, so a caller
/// chooses the fallback — silently substituting a colour would make a corrupt
/// value indistinguishable from a chosen one.
extension Color {
    init?(hex: String) {
        var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}
