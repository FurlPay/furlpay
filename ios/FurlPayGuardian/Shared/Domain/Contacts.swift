//
//  Contacts.swift
//
//  The address book's domain rules, on iOS.
//
//  THIS IS THE THIRD IMPLEMENTATION OF THESE RULES AND THAT IS THE PROBLEM IT
//  HAS TO MANAGE. They exist on the server (apps/web/src/lib/contacts.ts, which
//  is authoritative — it decides what is stored) and in the Android app
//  (native-app/lib/contacts/model.ts). There is no shared runtime between a
//  Next.js route, a React Native bundle and a Swift binary, so a third copy is
//  unavoidable; what is avoidable is the three drifting.
//
//  So every rule below names the behaviour it must match and why, in the same
//  words as its counterparts, and the tests in Tests/ContactsTests.swift assert
//  the same cases the Jest suite does. A change to any one of the three should
//  fail the other two's tests before it ships.
//
//  THE FOUR RULES THAT MUST NOT DRIFT, because each one is a wrong payment:
//
//    1. Family-scoped defaults. `isDefault` is per chain FAMILY, not per
//       contact. A contact with an EVM address and a Solana address needs a
//       preferred address on each.
//    2. EVM case folding, never base58. EIP-55 is a checksum, not an identity,
//       so two casings of one Ethereum address are one address. Base58 IS
//       case-sensitive, and folding it merges two different Solana accounts.
//    3. No cross-family fallback. A contact with nothing payable on the chain
//       being paid returns NOTHING. Pre-selecting an address that cannot
//       receive the transfer is worse than pre-selecting none, because it looks
//       like an answer.
//    4. An address is only valid on its declared chain. A contact holding an
//       unpayable address is worse than no contact — it looks authoritative and
//       fails at submit.
//

import Foundation

// MARK: - Model

/// Every network FurlPay can hold a balance on.
///
/// Mirrors `Chain` in packages/types. `CaseIterable` is what makes the
/// exhaustiveness of `family` checkable rather than assumed.
public enum ContactChain: String, Codable, Sendable, CaseIterable, Hashable {
    case ethereum, polygon, base, arbitrum, solana, gnosis, robinhood, bsc
}

/// The two address shapes FurlPay can pay. Solana is the only non-EVM one.
public enum AddressFamily: String, Sendable, Hashable {
    case evm
    case solana
}

public extension ContactChain {
    /// Rule 1's foundation: which family a chain belongs to.
    var family: AddressFamily {
        switch self {
        case .solana: .solana
        // Written out rather than `default:` on purpose — a chain added to the
        // enum is then a compile error here, forcing the family decision
        // instead of silently inheriting `.evm`.
        case .ethereum, .polygon, .base, .arbitrum, .gnosis, .robinhood, .bsc: .evm
        }
    }

    /// Human name, for a picker row.
    var displayName: String {
        switch self {
        case .ethereum: "Ethereum"
        case .polygon: "Polygon"
        case .base: "Base"
        case .arbitrum: "Arbitrum One"
        case .solana: "Solana"
        case .gnosis: "Gnosis"
        case .robinhood: "Robinhood Chain"
        case .bsc: "BNB Chain"
        }
    }
}

public struct ContactAddress: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let address: String
    public let chain: ContactChain
    public let label: String?
    /// Preferred address for this contact **on this chain family** — rule 1.
    public let isDefault: Bool

    public init(id: String, address: String, chain: ContactChain, label: String? = nil, isDefault: Bool = false) {
        self.id = id
        self.address = address
        self.chain = chain
        self.label = label
        self.isDefault = isDefault
    }
}

public struct Contact: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let avatarColor: String
    public let addresses: [ContactAddress]
    public let isFavorite: Bool
    /// Milliseconds since epoch, as the API emits them. Decoded as a number
    /// rather than a Date: these two fields are the only ones on the contact
    /// payload that are not ISO-8601 strings, and the client's custom date
    /// strategy would reject them.
    public let createdAt: Double
    public let updatedAt: Double

    public init(
        id: String,
        name: String,
        avatarColor: String,
        addresses: [ContactAddress],
        isFavorite: Bool = false,
        createdAt: Double = 0,
        updatedAt: Double = 0
    ) {
        self.id = id
        self.name = name
        self.avatarColor = avatarColor
        self.addresses = addresses
        self.isFavorite = isFavorite
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

// MARK: - Address classification

public enum ContactRules {

    /// The same shape checks the other two clients use, and the same ones the
    /// server validates with.
    ///
    /// Deliberately regex-free for the EVM case: a 42-character `0x` + hex
    /// check is exact, cheap, and cannot be got subtly wrong by a quantifier.
    public static func classify(_ raw: String) -> AddressFamily? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        if value.count == 42, value.hasPrefix("0x") || value.hasPrefix("0X") {
            let hex = value.dropFirst(2)
            if hex.allSatisfy(\.isHexDigit) { return .evm }
        }

        // Base58: 32–44 characters, and the four ambiguous glyphs 0 O I l are
        // excluded from the alphabet precisely so they cannot be misread.
        if (32...44).contains(value.count) {
            let base58 = Set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
            if value.allSatisfy({ base58.contains($0) }) { return .solana }
        }

        return nil
    }

    /// Every chain this address could belong to.
    ///
    /// Derived from the string rather than asked for — the address already
    /// answers the family question, and making the user answer it again is how
    /// an unpayable contact gets saved. One EVM address is valid on seven
    /// networks, so this narrows the choice without making it.
    public static func chains(for address: String) -> [ContactChain] {
        guard let family = classify(address) else { return [] }
        return ContactChain.allCases.filter { $0.family == family }
    }

    /// Rule 2. Normalised comparison key.
    ///
    /// EVM is lower-cased because EIP-55 is a checksum over an address, not a
    /// different address. Base58 is left exactly as written, because case is
    /// significant there and folding it would treat two distinct Solana
    /// accounts as one.
    public static func key(_ address: String, _ chain: ContactChain) -> String {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalised = chain.family == .evm ? trimmed.lowercased() : trimmed
        return "\(chain.rawValue):\(normalised)"
    }

    // MARK: Selection

    /// Every address on `contact` that can receive on `chain`'s family.
    ///
    /// What decides whether a tap resolves straight to a payment or has to open
    /// an address picker first — getting it wrong pays an address the user
    /// never looked at.
    public static func addresses(of contact: Contact, on chain: ContactChain) -> [ContactAddress] {
        contact.addresses.filter { $0.chain.family == chain.family }
    }

    /// Rules 1 and 3. The address to pre-select when paying `contact` on
    /// `chain`: the family default, else the first payable one, else NOTHING.
    ///
    /// The `nil` return is the important case and callers must not paper over
    /// it. There is no fallback to another family: an EVM address offered for a
    /// Solana send is not a helpful guess, it is a loss.
    public static func defaultAddress(of contact: Contact, on chain: ContactChain) -> ContactAddress? {
        let payable = addresses(of: contact, on: chain)
        return payable.first(where: \.isDefault) ?? payable.first
    }

    /// Contacts that can be paid on `chain`, with their other families'
    /// addresses stripped.
    ///
    /// Offering a contact whose only address is on another network invites
    /// exactly the mistake the address book exists to prevent, so they are
    /// removed rather than shown disabled.
    public static func contacts(_ contacts: [Contact], payableOn chain: ContactChain) -> [Contact] {
        contacts.compactMap { contact in
            let matching = addresses(of: contact, on: chain)
            guard !matching.isEmpty else { return nil }
            return Contact(
                id: contact.id,
                name: contact.name,
                avatarColor: contact.avatarColor,
                addresses: matching,
                isFavorite: contact.isFavorite,
                createdAt: contact.createdAt,
                updatedAt: contact.updatedAt
            )
        }
    }

    /// Search over names AND addresses, favourites first then alphabetical.
    ///
    /// The same ordering the server returns, so a locally filtered list and a
    /// server-filtered one never disagree about where a row sits. Matching the
    /// address is what answers "is this string on my clipboard someone I already
    /// know?", which a name search cannot.
    public static func search(_ contacts: [Contact], query: String) -> [Contact] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matches = q.isEmpty
            ? contacts
            : contacts.filter { contact in
                contact.name.lowercased().contains(q)
                    || contact.addresses.contains { $0.address.lowercased().contains(q) }
            }
        return matches.sorted { a, b in
            if a.isFavorite != b.isFavorite { return a.isFavorite }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    /// Rule 2 in the form the send screen needs: whose address is this?
    ///
    /// Matched on the address AND the chain together. A contact matched on the
    /// address alone would put a trusted name beside an address for a network
    /// they never gave one on — a false confirmation, on the one screen where a
    /// false confirmation costs money.
    public static func contact(
        owning address: String,
        on chain: ContactChain,
        in contacts: [Contact]
    ) -> Contact? {
        let wanted = key(address, chain)
        return contacts.first { contact in
            contact.addresses.contains { key($0.address, $0.chain) == wanted }
        }
    }

    /// The letter on the avatar. Never empty — a contact named with an emoji
    /// would otherwise render a blank circle.
    public static func initial(of name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }
}
