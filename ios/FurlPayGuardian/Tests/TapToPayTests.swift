//
//  TapToPayTests.swift
//
//  The tap itself cannot be tested — ProximityReader needs the physical Secure
//  Element and does not exist in the Simulator. What CAN be tested is
//  everything that decides what a customer is charged and whether a terminal is
//  offered at all, which is where the costly mistakes live.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Till amount entry")
struct AmountEntryTests {

    @Test("Digits fill from the right, till-style")
    func fillsFromRight() {
        var entry = AmountEntry()
        entry.press("1")
        #expect(entry.amount == Decimal(string: "0.01"))
        entry.press("2")
        #expect(entry.amount == Decimal(string: "0.12"))
        entry.press("5")
        #expect(entry.amount == Decimal(string: "1.25"))
    }

    @Test("Backspace removes the last digit")
    func backspace() {
        var entry = AmountEntry()
        for key in ["1", "2", "5"] { entry.press(key) }
        entry.press("⌫")
        #expect(entry.amount == Decimal(string: "0.12"))
    }

    @Test("Backspacing an empty amount stays at zero rather than going negative")
    func backspaceFloor() {
        var entry = AmountEntry()
        for _ in 0..<5 { entry.press("⌫") }
        #expect(entry.amount == 0)
    }

    @Test("The decimal key is inert — position implies the point")
    func decimalIsInert() {
        // Accepting "." would allow "1.2.5". In till entry the point is implied.
        var entry = AmountEntry()
        entry.press("1"); entry.press("."); entry.press("2"); entry.press("."); entry.press("5")
        #expect(entry.amount == Decimal(string: "1.25"))
    }

    @Test("Entry is capped, so a leaning thumb cannot ring up eight figures")
    func capped() {
        var entry = AmountEntry()
        for _ in 0..<12 { entry.press("9") }
        #expect(entry.amount <= 10_000)
    }

    @Test("Non-digit keys are ignored")
    func ignoresJunk() {
        var entry = AmountEntry()
        entry.press("1")
        entry.press("x")
        entry.press("")
        #expect(entry.amount == Decimal(string: "0.01"))
    }
}

@Suite("Charge")
struct TapToPayChargeTests {

    @Test("Minor units are exact, not floating point", arguments: [
        ("0.01", 1), ("1.25", 125), ("19.99", 1999),
        ("100.00", 10000), ("9999.99", 999999),
    ])
    func minorUnits(literal: String, expected: Int) throws {
        // A Double round trip is how 19.99 becomes 1998 on someone's receipt.
        let amount = try #require(Decimal(string: literal))
        #expect(TapToPayCharge(amount: amount).minorUnits == expected)
    }

    @Test("Rounding is half-up, the way a till rounds")
    func rounding() throws {
        let amount = try #require(Decimal(string: "1.005"))
        #expect(TapToPayCharge(amount: amount).minorUnits == 101)
    }

    @Test("Zero and negative amounts are invalid")
    func rejectsNonPositive() {
        #expect(!TapToPayCharge(amount: 0).isValid)
        #expect(!TapToPayCharge(amount: -5).isValid)
    }

    @Test("Amounts above the policy ceiling are invalid")
    func rejectsHuge() {
        #expect(TapToPayCharge(amount: 10_000).isValid)
        #expect(!TapToPayCharge(amount: 10_000.01).isValid)
    }

    @Test("Each charge gets its own idempotency key by default")
    func distinctKeys() {
        let a = TapToPayCharge(amount: 10)
        let b = TapToPayCharge(amount: 10)
        #expect(a.idempotencyKey != b.idempotencyKey)
    }

    @Test("An explicit key is preserved, so a retry is the SAME sale")
    func preservesKey() {
        let key = "sale-abc"
        #expect(TapToPayCharge(amount: 10, idempotencyKey: key).idempotencyKey == key)
    }
}

@Suite("Unavailability")
struct TapToPayAvailabilityTests {

    private let all: [TapToPayUnavailability] = [
        .deviceNotSupported, .osTooOld, .osIsBeta,
        .regionNotSupported("Brazil"), .regionNotSupported(nil),
        .notEntitled, .noProvider, .termsNotAccepted,
        .merchantNotOnboarded("Verification pending"), .merchantNotOnboarded(nil),
    ]

    @Test("Every reason has a title and a detail")
    func allExplained() {
        for reason in all {
            #expect(!reason.title.isEmpty, "\(reason)")
            #expect(!reason.detail.isEmpty, "\(reason)")
        }
    }

    @Test("Permanent blockers are not marked recoverable")
    func recoverabilityIsHonest() {
        // Offering "try again" for hardware that will never support it is
        // cruelty, not helpfulness.
        #expect(!TapToPayUnavailability.deviceNotSupported.isRecoverable)
        #expect(!TapToPayUnavailability.regionNotSupported("Brazil").isRecoverable)
        #expect(!TapToPayUnavailability.notEntitled.isRecoverable)

        #expect(TapToPayUnavailability.osTooOld.isRecoverable)
        #expect(TapToPayUnavailability.termsNotAccepted.isRecoverable)
        #expect(TapToPayUnavailability.noProvider.isRecoverable)
    }

    @Test("A named region appears in the copy")
    func namesRegion() {
        #expect(TapToPayUnavailability.regionNotSupported("Brazil").detail.contains("Brazil"))
    }
}

@Suite("Unconfigured provider fails closed")
struct UnconfiguredProviderTests {

    private let provider = UnconfiguredTapToPayProvider()

    @Test("Availability reports no provider rather than pretending")
    func reportsNoProvider() async {
        #expect(await provider.availability() == .unavailable(.noProvider))
    }

    @Test("Collecting throws instead of returning a fake success")
    func collectThrows() async {
        // The worst outcome this feature can produce is a merchant believing
        // they were paid when they weren't. It must never succeed silently.
        do {
            _ = try await provider.collect(TapToPayCharge(amount: 25))
            Issue.record("an unconfigured provider must never report a payment")
        } catch let error as TapToPayError {
            #expect(error == .unavailable(.noProvider))
        } catch {
            Issue.record("unexpected error type: \(error)")
        }
    }

    @Test("Accepting terms throws too")
    func termsThrow() async {
        await #expect(throws: TapToPayError.self) {
            try await provider.acceptTermsIfNeeded()
        }
    }
}

@Suite("Merchant-facing errors")
struct TapToPayErrorCopyTests {

    @Test("A decline does not blame the app")
    func declineCopy() {
        // The merchant is standing in front of the customer. "Something went
        // wrong" invites them to retry a card the issuer already refused.
        let copy = TapToPayService.message(for: .declined(nil)).lowercased()
        #expect(copy.contains("declined"))
        #expect(!copy.contains("error"))
        #expect(!copy.contains("wrong"))
    }

    @Test("A card-read failure tells the merchant what to do about it")
    func readFailureIsActionable() {
        let copy = TapToPayService.message(for: .cardReadFailed("x")).lowercased()
        #expect(copy.contains("closer") || copy.contains("hold"))
    }

    @Test("A network failure states the payment was NOT taken")
    func networkCopyIsUnambiguous() {
        // Ambiguity here is what causes double-charging: a merchant who is not
        // sure whether it went through will run the card again.
        let copy = TapToPayService.message(for: .network("timeout")).lowercased()
        #expect(copy.contains("wasn't taken") || copy.contains("not taken"))
    }

    @Test("Every error produces non-empty copy", arguments: [
        TapToPayError.unavailable(.noProvider),
        .invalidAmount,
        .cardReadFailed("x"),
        .declined("Insufficient funds"),
        .cancelled,
        .network("offline"),
        .providerFailure("PSP down"),
    ])
    func allHaveCopy(error: TapToPayError) {
        #expect(!TapToPayService.message(for: error).isEmpty)
    }

    @Test("Only cancellation is treated as a cancellation")
    func cancellationFlag() {
        #expect(TapToPayError.cancelled.isCancellation)
        #expect(!TapToPayError.declined(nil).isCancellation)
        #expect(!TapToPayError.network("x").isCancellation)
    }
}
