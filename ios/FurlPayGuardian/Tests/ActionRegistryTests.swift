//
//  ActionRegistryTests.swift
//
//  The registry is the one file here where a bug is dangerous rather than
//  merely broken: it decides whether an AI-proposed action reaches the network.
//  These tests pin the invariant — the request is rebuilt from the registry, and
//  anything the model invented is dropped or rejected.
//
//  THEY ALSO PIN PARITY, which is why `parityWithSharedRegistry` exists. An
//  earlier revision of these tests asserted the field names of a registry that
//  had drifted from copilotActions.ts on every action — `notionalUsd` for
//  `notional`, a 100_000 cap against the other platforms' 25_000, and
//  `"to": "alice"` accepted as a payment recipient because no `pattern` was
//  declared. The suite passed, because it was testing the drift against itself.
//  A test that only compares an implementation to itself cannot catch this;
//  the field names below are transcribed from the TypeScript on purpose.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Action registry")
struct ActionRegistryTests {

    private func confirmation(
        action: String?,
        endpoint: String,
        method: String? = "POST",
        body: [String: JSONValue]?,
        amountUsd: Double? = nil
    ) -> Confirmation {
        Confirmation(
            action: action, endpoint: endpoint, method: method,
            body: body, summary: "test", amountUsd: amountUsd
        )
    }

    private static let validQuoteId = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607"
    private static let validAddress = "0x1111111111111111111111111111111111111111"

    // MARK: The happy path

    @Test("A well-formed action resolves and keeps its declared fields")
    func resolvesValidAction() throws {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order",
            endpoint: "/investing/order",
            body: ["symbol": .string("AAPL"), "side": .string("buy"), "notional": .number(50)]
        ))

        guard case .ok(_, let endpoint, let method, let body, let details, _) = result else {
            Issue.record("expected .ok, got \(result)")
            return
        }
        #expect(endpoint == "/investing/order")
        #expect(method == "POST")
        #expect(body["symbol"] == .string("AAPL"))
        // `notional` is the name /api/investing/order requires; `notionalUsd`
        // was stripped by its Zod schema and the route 400'd.
        #expect(body["notional"] == .number(50))
        #expect(details.count == 3)
    }

    // MARK: Rejections

    @Test("An unknown action id is rejected rather than inferred from the endpoint")
    func rejectsUnknownAction() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "drain_wallet", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL")]
        ))
        guard case .rejected = result else {
            Issue.record("an unregistered id must never resolve")
            return
        }
    }

    @Test("A missing action id is rejected")
    func rejectsMissingAction() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: nil, endpoint: "/investing/order", body: [:]
        ))
        guard case .rejected = result else {
            Issue.record("no id means no authority")
            return
        }
    }

    @Test("An endpoint that disagrees with the registry is rejected")
    func rejectsMismatchedEndpoint() {
        // The attack this stops: a valid id paired with an endpoint of the
        // model's choosing.
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/payments/create",
            body: ["symbol": .string("AAPL"), "side": .string("buy"), "notional": .number(50)]
        ))
        guard case .rejected = result else {
            Issue.record("endpoint must match the spec")
            return
        }
    }

    @Test("A mismatched method is rejected")
    func rejectsMismatchedMethod() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order", method: "DELETE",
            body: ["symbol": .string("AAPL"), "side": .string("buy"), "notional": .number(50)]
        ))
        guard case .rejected = result else {
            Issue.record("method must match the spec")
            return
        }
    }

    @Test("A value outside the declared bounds is rejected")
    func rejectsOutOfRange() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL"), "side": .string("buy"),
                   "notional": .number(1_000_000)]        // cap is 25_000
        ))
        guard case .rejected = result else {
            Issue.record("an amount above the cap must not reach the network")
            return
        }
    }

    @Test("A value outside the declared enum is rejected")
    func rejectsBadEnum() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL"), "side": .string("short"), "notional": .number(50)]
        ))
        guard case .rejected = result else {
            Issue.record("side must be buy or sell")
            return
        }
    }

    @Test("A missing required field is rejected")
    func rejectsMissingField() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL")]              // no side, no amount
        ))
        guard case .rejected = result else {
            Issue.record("required fields are required")
            return
        }
    }

    // MARK: The core invariant

    @Test("Fields the model invented are dropped, not forwarded")
    func dropsUndeclaredFields() throws {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order",
            endpoint: "/investing/order",
            body: [
                "symbol": .string("AAPL"),
                "side": .string("buy"),
                "notional": .number(50),
                // None of these are in the spec. All must vanish.
                "destinationAddress": .string("0xattacker"),
                "bypassLimits": .bool(true),
                "adminOverride": .string("true"),
            ]
        ))

        guard case .ok(_, _, _, let body, _, _) = result else {
            Issue.record("expected .ok")
            return
        }
        #expect(body.count == 3, "only declared fields may survive")
        #expect(body["destinationAddress"] == nil)
        #expect(body["bypassLimits"] == nil)
        #expect(body["adminOverride"] == nil)
    }

    @Test("Optional fields may be omitted")
    func allowsOmittedOptionals() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "execute_swap", endpoint: "/swaps",
            // Pair and amount are display-only echoes and optional.
            body: ["quoteId": .string(Self.validQuoteId)]
        ))
        guard case .ok = result else {
            Issue.record("optional fields are optional")
            return
        }
    }

    // MARK: Patterns — the constraint that was missing entirely

    @Test("A payment recipient that is not an EVM address is rejected")
    func rejectsNonAddressRecipient() {
        // This exact confirmation used to RESOLVE, and an older revision of
        // this suite asserted that it should.
        for recipient in ["alice", "0xshort", "", "0x" + String(repeating: "z", count: 40)] {
            let result = GuardianActionRegistry.resolve(confirmation(
                action: "send_payment", endpoint: "/payments/create",
                body: [
                    "amount": .number(10),
                    "recipient": .string(recipient),
                    "sourceChain": .string("arbitrum"),
                ]
            ))
            guard case .rejected = result else {
                Issue.record("'\(recipient)' is not an address and must not resolve")
                return
            }
        }
    }

    @Test("A well-formed payment resolves under the corrected field names")
    func resolvesPayment() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "send_payment", endpoint: "/payments/create",
            body: [
                "amount": .number(10),
                "recipient": .string(Self.validAddress),
                "sourceChain": .string("arbitrum"),
            ]
        ))
        guard case .ok(_, _, _, let body, _, _) = result else {
            Issue.record("expected .ok, got \(result)")
            return
        }
        // PaymentCreateSchema's names, not `to`/`amountUsd`.
        #expect(body["amount"] == .number(10))
        #expect(body["recipient"] == .string(Self.validAddress))
    }

    @Test("A quote id that is not a uuid is rejected")
    func rejectsNonUuidQuoteId() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "execute_swap", endpoint: "/swaps",
            body: ["quoteId": .string("../../admin")]
        ))
        guard case .rejected = result else {
            Issue.record("a quote id is a uuid or it is nothing")
            return
        }
    }

    // MARK: Registry constants

    @Test("The swap carries execute:true, so it settles instead of re-quoting")
    func injectsSettleDiscriminator() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "execute_swap", endpoint: "/swaps",
            body: ["quoteId": .string(Self.validQuoteId)]
        ))
        guard case .ok(_, _, _, let body, _, _) = result else {
            Issue.record("expected .ok")
            return
        }
        #expect(body["execute"] == .bool(true))
    }

    @Test("A payload cannot override a registry constant")
    func constantsWinOverPayload() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "execute_swap", endpoint: "/swaps",
            body: ["quoteId": .string(Self.validQuoteId), "execute": .bool(false)]
        ))
        guard case .ok(_, _, _, let body, _, _) = result else {
            Issue.record("expected .ok")
            return
        }
        #expect(body["execute"] == .bool(true))
    }

    // MARK: The confirmation prompt

    @Test("The prompt amount comes from the body, not the payload's claim")
    func amountIsReadBackFromTheBody() {
        // The spoof: a payload claiming $5 while authorising $9,000. The
        // resolved amount must follow the body, because the body is what gets
        // sent — this is the figure ServiceContainer puts above Face ID.
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL"), "side": .string("buy"),
                   "notional": .number(9_000)],
            amountUsd: 5
        ))
        guard case .ok(_, _, _, _, _, let amountUsd) = result else {
            Issue.record("expected .ok")
            return
        }
        #expect(amountUsd == 9_000)
    }

    @Test("A missing body is rejected outright")
    func rejectsAbsentBody() {
        let result = GuardianActionRegistry.resolve(confirmation(
            action: "execute_swap", endpoint: "/swaps", body: nil
        ))
        guard case .rejected = result else {
            Issue.record("no body means no action")
            return
        }
    }

    @Test("A string is not a number and a string is not a bool")
    func rejectsTypeCoercion() {
        // Kotlin rejects string primitives for NUMBER/BOOLEAN and TS rejects on
        // `typeof`; coercing here would be drift.
        let order = GuardianActionRegistry.resolve(confirmation(
            action: "place_order", endpoint: "/investing/order",
            body: ["symbol": .string("AAPL"), "side": .string("buy"),
                   "notional": .string("50")]
        ))
        guard case .rejected = order else {
            Issue.record("a quoted amount is the wrong type")
            return
        }

        let card = GuardianActionRegistry.resolve(confirmation(
            action: "card_control", endpoint: "/cards/settings",
            body: ["cardId": .string("card-1"), "freeze": .string("true")]
        ))
        guard case .rejected = card else {
            Issue.record("a quoted bool is the wrong type")
            return
        }
    }

    @Test("Endpoint comparison tolerates an /api prefix and a trailing slash")
    func normalisesEndpoint() {
        for endpoint in ["/api/investing/order", "investing/order", "/investing/order/"] {
            let result = GuardianActionRegistry.resolve(confirmation(
                action: "place_order", endpoint: endpoint,
                body: ["symbol": .string("AAPL"), "side": .string("buy"), "notional": .number(50)]
            ))
            guard case .ok = result else {
                Issue.record("'\(endpoint)' should normalise to the registered path")
                return
            }
        }
    }

    @Test("Every registered action declares a non-empty endpoint and at least one field")
    func registryIsWellFormed() {
        for spec in GuardianActionRegistry.actions {
            #expect(!spec.id.isEmpty)
            #expect(spec.endpoint.hasPrefix("/"), "\(spec.id) endpoint must be a path")
            #expect(!spec.fields.isEmpty, "\(spec.id) declares no fields")
        }
    }

    // MARK: Cross-platform parity
    //
    // The check that was missing. Every other test in this suite compares the
    // registry to itself, so all of them passed while the iOS copy had drifted
    // from copilotActions.ts and GuardianActionRegistry.kt on every action —
    // and two of those drifts meant the request the user authorised was
    // rejected or silently ignored by the server.
    //
    // The expectations below are transcribed from the TypeScript. Changing this
    // registry without changing the other two now fails here.

    /// id → (endpoint, ordered field names, required field names).
    private static let expected: [String: (String, [String], Set<String>)] = [
        "card_control": ("/cards/settings", ["cardId", "freeze"], ["cardId", "freeze"]),
        "earn_deposit": ("/earn/deposit", ["token", "amountUsd"], ["token", "amountUsd"]),
        "schedule_dca": (
            "/investing/schedule",
            ["symbol", "side", "notional", "cadence"],
            ["symbol", "side", "notional", "cadence"]
        ),
        "place_order": (
            "/investing/order", ["symbol", "side", "notional"], ["symbol", "side", "notional"]
        ),
        "execute_swap": (
            "/swaps", ["quoteId", "fromToken", "toToken", "amountIn"], ["quoteId"]
        ),
        "send_payment": (
            "/payments/create",
            ["amount", "recipient", "sourceChain"],
            ["amount", "recipient", "sourceChain"]
        ),
        "create_support_ticket": (
            "/support/tickets", ["category", "subject", "body"], ["category", "subject", "body"]
        ),
    ]

    @Test("Action ids, endpoints and field names match copilotActions.ts")
    func parityWithSharedRegistry() {
        #expect(
            Set(GuardianActionRegistry.actions.map(\.id)) == Set(Self.expected.keys),
            "the set of registered actions differs from the TS registry"
        )

        for spec in GuardianActionRegistry.actions {
            guard let (endpoint, fields, required) = Self.expected[spec.id] else { continue }
            #expect(spec.endpoint == endpoint, "\(spec.id): endpoint drifted")
            #expect(spec.method == "POST", "\(spec.id): method drifted")
            #expect(spec.fields.map(\.0) == fields, "\(spec.id): field names or order drifted")

            let actualRequired = Set(spec.fields.filter { !$0.1.optional }.map(\.0))
            #expect(actualRequired == required, "\(spec.id): optionality drifted")
        }
    }

    @Test("The per-action ceiling matches MAX_ACTION_USD on the other platforms")
    func parityOnTheCeiling() {
        // Was 100_000 here against 25_000 in TS and Kotlin — a co-pilot
        // confirmation on iPhone could authorise four times what the same
        // confirmation authorised on Android.
        #expect(GuardianActionRegistry.maxActionUsd == 25_000)

        for spec in GuardianActionRegistry.actions {
            for (name, field) in spec.fields where field.usd {
                #expect(
                    field.max == GuardianActionRegistry.maxActionUsd,
                    "\(spec.id).\(name) is a USD field with a different cap"
                )
            }
        }
    }

    @Test("Every free-text or identifier field is constrained")
    func everyStringFieldIsConstrained() {
        // The drift that mattered most was silent: `pattern` existed on
        // FieldSpec and not one action used it, so an AI-proposed payment could
        // carry any string at all as its recipient.
        for spec in GuardianActionRegistry.actions {
            for (name, field) in spec.fields where field.type == .string {
                #expect(
                    field.oneOf != nil || field.pattern != nil,
                    "\(spec.id).\(name) accepts arbitrary strings"
                )
            }
        }
    }
}

@Suite("Portfolio maths")
struct PortfolioTests {

    private func position(_ symbol: String, value: Decimal) -> Position {
        Position(symbol: symbol, name: symbol, quantity: 1, avgCost: value,
                 currentPrice: value, marketValue: value,
                 unrealizedPnl: 0, unrealizedPnlPercent: 0)
    }

    @Test("A single holding is undiversified")
    func singleHoldingScoresZero() {
        let summary = PortfolioSummary(
            totalUsd: 100, dayChangeUsd: 0, dayChangePercent: 0,
            positions: [position("BTC", value: 100)]
        )
        #expect(summary.diversificationScore == 0)
    }

    @Test("Evenly split holdings score near the maximum")
    func evenHoldingsScoreHigh() {
        let summary = PortfolioSummary(
            totalUsd: 100, dayChangeUsd: 0, dayChangePercent: 0,
            positions: [position("A", value: 25), position("B", value: 25),
                        position("C", value: 25), position("D", value: 25)]
        )
        #expect(summary.diversificationScore > 0.99)
    }

    @Test("Stablecoin share is recognised by symbol")
    func stablecoinShare() {
        let summary = PortfolioSummary(
            totalUsd: 100, dayChangeUsd: 0, dayChangePercent: 0,
            positions: [position("USDC", value: 40), position("BTC", value: 60)]
        )
        #expect(abs(summary.stablecoinShare - 0.4) < 0.001)
    }

    @Test("An empty portfolio does not divide by zero")
    func emptyPortfolioIsSafe() {
        #expect(PortfolioSummary.empty.diversificationScore == 0)
        #expect(PortfolioSummary.empty.stablecoinShare == 0)
    }
}
