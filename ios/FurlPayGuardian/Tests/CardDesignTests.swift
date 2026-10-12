//
//  CardDesignTests.swift
//
//  The card artwork is chosen from what the server sends, and the back of a
//  card can only ever print masks. Both are parity points with the Expo app
//  (native-app/lib/__tests__/cardDesigns.test.ts) and Wear OS (CardDesignTest).
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Card design")
struct CardDesignTests {

    @Test func recognisesTheThreeDesignsByTheServersGradient() {
        #expect(CardDesign(gradient: ["#14197D", "#006BFF"]) == .electric)
        #expect(CardDesign(gradient: ["#060b21", "#0b2a6b"]) == .world)
        #expect(CardDesign(gradient: ["#F1F0FF", "#C7A7F8"]) == .pearl)
    }

    @Test func olderThemesAndMissingGradientsHaveNoDesign() {
        #expect(CardDesign(gradient: nil) == nil)
        #expect(CardDesign(gradient: []) == nil)
        #expect(CardDesign(gradient: ["#0B1220", "#1E293B"]) == nil)
        #expect(CardDesign(gradient: ["#14197D"]) == nil)
    }

    @Test func aCardDecodesItsGradient() throws {
        let json = #"{"id":"c1","last4":"4821","kind":"virtual","network":"visa","frozen":false,"label":"Everyday","gradient":["#F1F0FF","#C7A7F8"]}"#
        let card = try JSONDecoder().decode(Card.self, from: Data(json.utf8))
        #expect(card.design == .pearl)
    }

    @Test func aCardWithoutOrWithAMalformedGradientStillDecodes() throws {
        let plain = #"{"id":"c1","last4":"4821","frozen":false,"label":"Everyday"}"#
        #expect(try JSONDecoder().decode(Card.self, from: Data(plain.utf8)).design == nil)

        let malformed = #"{"id":"c1","last4":"4821","frozen":false,"label":"Everyday","gradient":"blue"}"#
        let card = try JSONDecoder().decode(Card.self, from: Data(malformed.utf8))
        #expect(card.gradient == nil)
        #expect(card.last4 == "4821")
    }
}

@Suite("Card back")
struct CardBackTests {

    @Test func printsMasksAndNoDigitBeyondTheLastFour() {
        let fields = CardBackFields.masked(last4: "4821")
        #expect(fields.number == "•••• •••• •••• 4821")
        #expect(fields.expiry == "••/••")
        #expect(fields.cvv == "•••")
        let digits = (fields.number + fields.expiry + fields.cvv).filter(\.isNumber)
        #expect(digits == "4821")
    }

    @Test func doesNotEchoALastFourThatIsNotFourDigits() {
        #expect(CardBackFields.masked(last4: "12").number == "•••• •••• •••• ••••")
        #expect(CardBackFields.masked(last4: "••••").number == "•••• •••• •••• ••••")
    }
}
