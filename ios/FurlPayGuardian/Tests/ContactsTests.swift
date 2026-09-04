//
//  ContactsTests.swift
//
//  The address-book rules exist three times — server, Android, iOS — because
//  there is no shared runtime between a Next.js route, a React Native bundle
//  and a Swift binary. These cases mirror, one for one, the ones in
//  native-app/lib/__tests__/contacts.test.ts, so a change on either platform
//  that breaks the shared contract fails on both rather than producing two apps
//  that quietly disagree about who an address belongs to.
//
//  The four rules under test are the four that are each a wrong payment:
//  family-scoped defaults, EVM case folding but never base58, no cross-family
//  fallback, and an address only ever valid on its declared chain.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Address book rules")
struct ContactsTests {

    // Fixtures shared with the Jest suite, character for character.
    static let evmA = "0x1111111111111111111111111111111111111111"
    static let evmB = "0x2222222222222222222222222222222222222222"
    static let solA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"

    private func address(
        _ id: String,
        _ value: String,
        _ chain: ContactChain,
        isDefault: Bool = false,
        label: String? = nil
    ) -> ContactAddress {
        ContactAddress(id: id, address: value, chain: chain, label: label, isDefault: isDefault)
    }

    private func contact(
        id: String = "c_1",
        name: String = "Alice",
        addresses: [ContactAddress] = [],
        favorite: Bool = false
    ) -> Contact {
        Contact(id: id, name: name, avatarColor: "#3B82F6", addresses: addresses, isFavorite: favorite)
    }

    // MARK: Classification

    @Test("recognises EVM and Solana shapes, and nothing else")
    func classifies() {
        #expect(ContactRules.classify(Self.evmA) == .evm)
        #expect(ContactRules.classify(Self.solA) == .solana)
        #expect(ContactRules.classify("") == nil)
        #expect(ContactRules.classify("not-an-address") == nil)
        // Right prefix, wrong length — what a naive hasPrefix("0x") accepts.
        #expect(ContactRules.classify("0x1234") == nil)
    }

    @Test("tolerates surrounding whitespace, because pasted text has it")
    func trimsInput() {
        #expect(ContactRules.classify("  \(Self.evmA)\n") == .evm)
    }

    @Test("rejects base58's four ambiguous glyphs")
    func rejectsAmbiguousBase58() {
        // 0, O, I and l are excluded from the alphabet precisely so they cannot
        // be misread; accepting them would let a typo'd address look valid.
        let withZero = "0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
        #expect(ContactRules.classify(withZero) == nil)
    }

    @Test("offers every chain an address could belong to, and only those")
    func derivesChains() {
        let evm = ContactRules.chains(for: Self.evmA)
        #expect(evm.contains(.base))
        #expect(evm.contains(.bsc))
        #expect(!evm.contains(.solana))

        // Exactly one answer for Solana — which is what lets a form pre-select
        // it instead of presenting a choice of one.
        #expect(ContactRules.chains(for: Self.solA) == [.solana])
        #expect(ContactRules.chains(for: "nope").isEmpty)
    }

    @Test("puts only Solana outside the EVM family")
    func families() {
        for chain in ContactChain.allCases {
            #expect(chain.family == (chain == .solana ? .solana : .evm))
        }
    }

    // MARK: Rule 2 — case folding

    @Test("folds EVM case but never base58 case")
    func caseFolding() {
        // EIP-55 is a checksum over an address, not a different address.
        let shouted = "0x" + Self.evmA.dropFirst(2).uppercased()
        #expect(ContactRules.key(shouted, .base) == ContactRules.key(Self.evmA, .base))

        // Base58 IS case-sensitive — folding merges two distinct accounts.
        #expect(ContactRules.key(Self.solA.uppercased(), .solana) != ContactRules.key(Self.solA, .solana))
    }

    @Test("scopes the key to the chain, so one address on two chains is two entries")
    func keyIncludesChain() {
        #expect(ContactRules.key(Self.evmA, .base) != ContactRules.key(Self.evmA, .polygon))
    }

    // MARK: Rules 1 and 3 — defaults and fallback

    @Test("prefers the family default")
    func prefersDefault() {
        let c = contact(addresses: [
            address("a1", Self.evmA, .base),
            address("a2", Self.evmB, .base, isDefault: true),
        ])
        #expect(ContactRules.defaultAddress(of: c, on: .base)?.id == "a2")
    }

    @Test("falls back to the first in the family when none is marked")
    func fallsBackWithinFamily() {
        let c = contact(addresses: [address("a1", Self.evmA, .arbitrum)])
        #expect(ContactRules.defaultAddress(of: c, on: .base)?.id == "a1")
    }

    @Test("returns nothing rather than an address from the other family")
    func neverCrossesFamilies() {
        // The whole point of rule 3: an EVM address offered for a Solana send
        // is not a helpful guess, it looks like an answer and is a loss.
        let c = contact(addresses: [address("a1", Self.evmA, .base)])
        #expect(ContactRules.defaultAddress(of: c, on: .solana) == nil)
    }

    @Test("treats every EVM chain as one family")
    func evmIsOneFamily() {
        // An address saved under `base` is still the right address to show
        // someone paying on `arbitrum` — same account, different network.
        let c = contact(addresses: [address("a1", Self.evmA, .base)])
        #expect(ContactRules.addresses(of: c, on: .arbitrum).count == 1)
    }

    @Test("returns every address in the family, not just the default")
    func listsWholeFamily() {
        // This decides whether a tap resolves straight to a payment or has to
        // open an address picker first.
        let c = contact(addresses: [
            address("a1", Self.evmA, .base, isDefault: true),
            address("a2", Self.evmB, .polygon),
            address("a3", Self.solA, .solana),
        ])
        #expect(ContactRules.addresses(of: c, on: .base).map(\.id) == ["a1", "a2"])
        #expect(ContactRules.addresses(of: c, on: .solana).map(\.id) == ["a3"])
    }

    // MARK: Filtering and search

    @Test("drops contacts with nothing payable on the chain, and strips the rest")
    func filtersByChain() {
        let alice = contact(id: "c_alice", name: "Alice", addresses: [
            address("a1", Self.evmA, .base),
            address("a2", Self.solA, .solana),
        ])
        let carol = contact(id: "c_carol", name: "Carol", addresses: [address("c1", Self.evmB, .base)])

        let onSolana = ContactRules.contacts([alice, carol], payableOn: .solana)
        #expect(onSolana.map(\.id) == ["c_alice"])

        let onBase = ContactRules.contacts([alice], payableOn: .base)
        #expect(onBase.first?.addresses.map(\.id) == ["a1"])
        // The input is untouched.
        #expect(alice.addresses.count == 2)
    }

    @Test("floats favourites, then sorts alphabetically")
    func searchOrdering() {
        let zoe = contact(id: "c_z", name: "Zoe", addresses: [address("z1", Self.evmA, .base)])
        let alice = contact(id: "c_a", name: "Alice")
        let bank = contact(id: "c_b", name: "Bank", favorite: true)
        #expect(ContactRules.search([zoe, alice, bank], query: "").map(\.id) == ["c_b", "c_a", "c_z"])
    }

    @Test("matches names case-insensitively and addresses too")
    func searchMatches() {
        let zoe = contact(id: "c_z", name: "Zoe", addresses: [address("z1", Self.evmA, .base)])
        let alice = contact(id: "c_a", name: "Alice")
        #expect(ContactRules.search([zoe, alice], query: "ALI").map(\.id) == ["c_a"])
        // Answers "is this string on my clipboard someone I already know?",
        // which a name search cannot.
        #expect(ContactRules.search([zoe, alice], query: String(Self.evmA.prefix(10))).map(\.id) == ["c_z"])
        #expect(ContactRules.search([zoe, alice], query: "qqqq").isEmpty)
    }

    // MARK: Ownership

    @Test("finds the owner regardless of EVM casing")
    func findsOwner() {
        let alice = contact(id: "c_alice", addresses: [address("a1", Self.evmA, .base)])
        let shouted = "0x" + Self.evmA.dropFirst(2).uppercased()
        #expect(ContactRules.contact(owning: shouted, on: .base, in: [alice])?.id == "c_alice")
    }

    @Test("will not name a contact for a chain they have no address on")
    func neverFalselyNames() {
        // A false confirmation here puts a trusted name beside an address that
        // cannot receive the payment.
        let alice = contact(id: "c_alice", addresses: [address("a1", Self.evmA, .base)])
        #expect(ContactRules.contact(owning: Self.evmA, on: .solana, in: [alice]) == nil)
        #expect(ContactRules.contact(owning: Self.evmB, on: .base, in: [alice]) == nil)
    }

    // MARK: Presentation

    @Test("never renders a blank avatar")
    func initials() {
        #expect(ContactRules.initial(of: "alice") == "A")
        #expect(ContactRules.initial(of: "   ") == "?")
        #expect(ContactRules.initial(of: "") == "?")
    }

    @Test("every chain has a display name")
    func displayNames() {
        for chain in ContactChain.allCases {
            #expect(!chain.displayName.isEmpty)
        }
    }

    // MARK: Wire format

    @Test("decodes the shape the contacts API actually returns")
    func decodesServerPayload() throws {
        // Timestamps are epoch MILLISECONDS on this payload, not ISO-8601 —
        // the client's custom date strategy would reject them, which is why
        // Contact declares them as Double rather than Date.
        let json = """
        {"contacts":[{"id":"ct_1","name":"Alice","avatarColor":"#3B82F6",
        "addresses":[{"id":"a1","address":"\(Self.evmA)","chain":"base","isDefault":true}],
        "isFavorite":false,"createdAt":1767225600000,"updatedAt":1767225600000}]}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(ContactsResponse.self, from: json)
        #expect(decoded.contacts.count == 1)
        let alice = try #require(decoded.contacts.first)
        #expect(alice.name == "Alice")
        #expect(alice.addresses.first?.chain == .base)
        #expect(alice.addresses.first?.isDefault == true)
        // `label` is optional on the wire and absent here.
        #expect(alice.addresses.first?.label == nil)
    }

    @Test("sends chains as the raw strings the server's enum accepts")
    func encodesChainRawValues() throws {
        let body = NewContactAddress(address: Self.solA, chain: .solana, label: "Exchange")
        let data = try JSONEncoder().encode(body)
        let text = try #require(String(data: data, encoding: .utf8))
        // A mismatch here is a 400 from z.enum(CHAINS) at the moment someone
        // tries to save a contact.
        #expect(text.contains("\"solana\""))
    }
}
