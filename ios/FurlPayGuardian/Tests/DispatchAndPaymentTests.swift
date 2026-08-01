//
//  DispatchAndPaymentTests.swift
//
//  Covers the two places where a mistake costs money: the dispatch chain that
//  decides whether an AI-proposed action reaches the network, and the Apple Pay
//  request the user actually authorises.
//

import Testing
import Foundation
import PassKit
@testable import FurlPayGuardian

@Suite("Action dispatch chain")
struct ActionDispatchTests {

    private func confirmation(
        action: String?, endpoint: String, body: [String: JSONValue]
    ) -> Confirmation {
        Confirmation(
            action: action, endpoint: endpoint, method: "POST",
            body: body, summary: "test", amountUsd: nil
        )
    }

    @Test("A rejected action yields no ApprovedAction")
    func rejectedCannotBeApproved() {
        // This is the invariant the type system is meant to carry: there is no
        // way to obtain an ApprovedAction from a rejection, so there is no way
        // to dispatch one.
        let resolved = GuardianActionRegistry.resolve(confirmation(
            action: "drain_wallet", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL")]
        ))
        #expect(resolved.approved == nil)
    }

    @Test("An approved action carries the REGISTRY's endpoint, not the payload's")
    func usesRegistryEndpoint() throws {
        // The payload's endpoint agreed here, so resolve() passed — but the
        // approved action must still read from the spec. If this ever came from
        // the confirmation, a future loosening of the match rule would silently
        // become an SSRF.
        let resolved = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/api/investing/order/",
            body: ["symbol": .string("AAPL"), "side": .string("buy"),
                   "notional": .number(50)]
        ))
        let approved = try #require(resolved.approved)
        #expect(approved.endpoint == "/investing/order")   // normalised spec form
        #expect(approved.actionId == "place_order")
        #expect(approved.method == "POST")
    }

    @Test("Undeclared fields never survive into the approved body")
    func approvedBodyIsRebuilt() throws {
        let resolved = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: [
                "symbol": .string("AAPL"), "side": .string("buy"),
                "notional": .number(50),
                "destinationAddress": .string("0xattacker"),
            ]
        ))
        let approved = try #require(resolved.approved)
        #expect(approved.body.count == 3)
        #expect(approved.body["destinationAddress"] == nil)
    }

    /// A value that satisfies `field`, so this test exercises the approval path
    /// rather than the rejection path.
    ///
    /// Every string field in the registry now carries an enum or a pattern, so
    /// the old placeholder ("x" for anything without a `oneOf`) would be
    /// rejected on all of them — which would have made this test pass for
    /// entirely the wrong reason.
    private func sample(for field: FieldSpec) -> JSONValue {
        switch field.type {
        case .boolean:
            return .bool(true)
        case .number:
            return .number(field.min ?? 1)
        case .string:
            if let allowed = field.oneOf?.first { return .string(allowed) }
            switch field.pattern {
            case "^0x[0-9a-fA-F]{40}$":
                return .string("0x" + String(repeating: "1", count: 40))
            case "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$":
                return .string("3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607")
            case "^[A-Z]{1,5}$", "^[A-Z0-9.]{1,12}$":
                return .string("AAPL")
            case "^[\\w-]{1,64}$":
                return .string("card-1")
            case "^[\\s\\S]{4,120}$":
                return .string("A subject line")
            case "^[\\s\\S]{10,5000}$":
                return .string("A message body long enough to pass.")
            default:
                return .string("x")
            }
        }
    }

    @Test("Every registry action can round-trip to an ApprovedAction")
    func allActionsApprovable() {
        // Guards against a spec being added with an endpoint or method the
        // approval path cannot express.
        for spec in GuardianActionRegistry.actions where spec.enabled {
            var body: [String: JSONValue] = [:]
            for (name, field) in spec.fields where !field.optional {
                body[name] = sample(for: field)
            }
            let resolved = GuardianActionRegistry.resolve(Confirmation(
                action: spec.id, endpoint: spec.endpoint, method: spec.method,
                body: body, summary: "t", amountUsd: nil
            ))
            #expect(resolved.approved != nil, "\(spec.id) did not approve")
        }
    }

    @Test("The approved amount is the body's, never the payload's claim")
    func approvedAmountIgnoresThePayloadClaim() throws {
        // The spoof this closes: `amountUsd` on the Confirmation is a display
        // hint the model controls. It used to be forwarded straight into
        // ApprovedAction and from there into the Face ID prompt, so a payload
        // could show "$5.00" over a body authorising $9,000.
        let resolved = GuardianActionRegistry.resolve(Confirmation(
            action: "place_order", endpoint: "/investing/order", method: "POST",
            body: ["symbol": .string("AAPL"), "side": .string("buy"),
                   "notional": .number(9_000)],
            summary: "Buy a little AAPL", amountUsd: 5
        ))
        let approved = try #require(resolved.approved)
        #expect(approved.amountUsd == 9_000)
        // And the card renders registry-derived fields, not the free-form text.
        #expect(approved.details.contains { $0.label == "Amount" && $0.value == "$9,000" })
    }
}

@Suite("Apple Pay request")
struct ApplePayTests {

    @Test("The request names the merchant, currency and networks we support")
    func requestShape() {
        let request = ApplePay.request(amountUsd: 50)
        #expect(request.merchantIdentifier == ApplePay.merchantIdentifier)
        #expect(request.currencyCode == "USD")
        #expect(request.countryCode == "US")
        #expect(request.supportedNetworks.contains(.visa))
        #expect(request.merchantCapabilities.contains(.threeDSecure))
    }

    @Test("The LAST summary item is the grand total")
    func totalIsLast() throws {
        // Apple renders the final item in bold as the amount being charged.
        // Getting the order wrong shows the user the wrong number at the moment
        // they authorise.
        let request = ApplePay.request(amountUsd: 125.50)
        let last = try #require(request.paymentSummaryItems.last)
        #expect(last.amount == NSDecimalNumber(decimal: 125.50))
        #expect(last.label == "FurlPay")
    }

    @Test("The charged amount matches the requested amount exactly", arguments: [
        Decimal(25), Decimal(50), Decimal(100), Decimal(0.01), Decimal(999.99),
    ])
    func amountIsExact(amount: Decimal) throws {
        // Decimal throughout — a Double round trip here is how 19.99 becomes
        // 19.989999999999998 on someone's receipt.
        let request = ApplePay.request(amountUsd: amount)
        let last = try #require(request.paymentSummaryItems.last)
        #expect(last.amount == NSDecimalNumber(decimal: amount))
    }
}

@Suite("Alarm identifiers")
struct AlarmIdentifierTests {

    @Test("The same event id always maps to the same alarm id")
    func deterministic() {
        // Cancel must find what schedule created. A non-deterministic mapping
        // would leave alarms ringing that nothing can stop.
        let a = GuardianAlarmKitScheduler.alarmId(for: "reminder-abc-123")
        let b = GuardianAlarmKitScheduler.alarmId(for: "reminder-abc-123")
        #expect(a == b)
    }

    @Test("Different event ids map to different alarm ids")
    func distinct() {
        let ids = ["evt-1", "evt-2", "reminder-x", "server-event-9931", "a"]
        let mapped = Set(ids.map { GuardianAlarmKitScheduler.alarmId(for: $0) })
        #expect(mapped.count == ids.count)
    }

    @Test("A UUID event id is used directly rather than re-hashed")
    func passesThroughUUIDs() {
        let uuid = UUID()
        #expect(GuardianAlarmKitScheduler.alarmId(for: uuid.uuidString) == uuid)
    }

    @Test("A `reminder-<uuid>` id recovers the embedded UUID")
    func extractsEmbeddedUUID() {
        let uuid = UUID()
        #expect(GuardianAlarmKitScheduler.alarmId(for: "reminder-\(uuid.uuidString)") == uuid)
    }
}

@Suite("Assistant availability")
struct AssistantAvailabilityTests {

    @Test("Every unavailable reason has actionable copy", arguments: [
        AssistantAvailability.unsupportedOS,
        .deviceNotEligible,
        .notEnabled,
        .modelNotReady,
        .unknown,
    ])
    func hasMessage(reason: AssistantAvailability) {
        #expect(!reason.userMessage.isEmpty)
    }

    @Test("Available has no message, because there is nothing to explain")
    func availableIsSilent() {
        #expect(AssistantAvailability.available.userMessage.isEmpty)
    }
}
