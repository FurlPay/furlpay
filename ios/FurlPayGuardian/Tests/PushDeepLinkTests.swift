//
//  PushDeepLinkTests.swift
//
//  The payload is server-supplied, so parsing it is the untrusted edge of the
//  push path. These tests pin the closed-enum behaviour: known links resolve,
//  everything else resolves to nothing.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Push deep links")
struct PushDeepLinkTests {

    @Test("Plain links resolve", arguments: [
        ("dashboard", GuardianDeepLink.dashboard),
        ("cards",     GuardianDeepLink.cards),
        ("wallet",    GuardianDeepLink.wallet),
        ("spending",  GuardianDeepLink.spending),
        ("portfolio", GuardianDeepLink.portfolio),
        ("markets",   GuardianDeepLink.markets),
        ("travel",    GuardianDeepLink.travel),
        ("reminders", GuardianDeepLink.reminders),
    ])
    func plainLinks(raw: String, expected: GuardianDeepLink) {
        #expect(GuardianDeepLink(payload: ["link": raw]) == expected)
    }

    @Test("Parameterised links carry their identifier")
    func parameterisedLinks() {
        #expect(GuardianDeepLink(payload: ["link": "card:card_123"]) == .card(id: "card_123"))
        #expect(GuardianDeepLink(payload: ["link": "stock:aapl"]) == .stock(symbol: "AAPL"))
    }

    @Test("A symbol containing a colon keeps everything after the first one")
    func splitsOnFirstColonOnly() {
        // maxSplits: 1 — an id is not re-parsed as another link.
        #expect(GuardianDeepLink(payload: ["link": "card:a:b"]) == .card(id: "a:b"))
    }

    @Test("Unknown, empty, and malformed links resolve to nil", arguments: [
        "settings", "admin", "https://furlpay.com/admin", "", "card", "card:",
        "stock:", "CARDS", "../cards",
    ])
    func rejectsUnknown(raw: String) {
        #expect(GuardianDeepLink(payload: ["link": raw]) == nil)
    }

    @Test("A payload with no link key resolves to nil")
    func rejectsMissingKey() {
        #expect(GuardianDeepLink(payload: ["aps": ["alert": "hi"]]) == nil)
        #expect(GuardianDeepLink(payload: [:]) == nil)
        #expect(GuardianDeepLink(payload: ["link": 42]) == nil)
    }

    @Test("quickPay is navigable but not reachable from a payload")
    func quickPayIsNotPushAddressable() {
        // It exists in the enum for the menu; no payload should produce it.
        #expect(GuardianDeepLink(payload: ["link": "quickPay"]) == nil)
        #expect(GuardianDeepLink(payload: ["link": "quickpay"]) == nil)
    }

    @MainActor
    @Test("Consuming a link clears it so a tap navigates once")
    func consumeIsIdempotent() {
        let service = PushNotificationService()
        service.pendingLink = .markets
        #expect(service.consumeLink() == .markets)
        #expect(service.consumeLink() == nil)
    }
}
