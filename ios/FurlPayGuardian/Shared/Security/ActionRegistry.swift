//
//  ActionRegistry.swift
//
//  Swift port of guardian/core/domain/action/GuardianActionRegistry.kt, which is
//  itself a port of native-app/lib/copilotActions.ts. All three must stay in
//  behavioural lockstep — a gap between them is a gap in the confirmation gate
//  on one platform only, which is the worst possible shape for this bug.
//
//  THE INVARIANT. The AI (Gemini voice, /api/chat co-pilot, or a prompt-injected
//  response) may PROPOSE an action. It must never define executable authority.
//  Every confirmable action is declared here with its exact id, endpoint, method
//  and body schema. The request that actually goes out is REBUILT FROM THIS
//  REGISTRY using allowed fields only:
//
//    - a field the model sent that is not in the spec is dropped
//    - a field whose type, range, pattern or enum does not match rejects the
//      whole action
//    - an endpoint or method that disagrees with the spec rejects the action
//
//  Rejection happens BEFORE the biometric prompt is shown. A user must never be
//  asked to Face ID something the app has already decided it will not send.
//
//  PARITY IS CHECKED, NOT ASSUMED. `Tests/ActionRegistryTests.swift` asserts the
//  field names, patterns, enums and bounds below against the values in
//  copilotActions.ts. An earlier revision of this file had drifted on every
//  action — different field names (`frozen` for `freeze`, `notionalUsd` for
//  `notional`), a 100_000 ceiling against the other platforms' 25_000, and no
//  `pattern` on any field, so an AI-proposed payment could carry any string at
//  all as its recipient. Two of those drifts also meant the request the user
//  authorised was silently rejected or ignored by the server.
//

import Foundation

// MARK: - Field specification

public enum FieldType: String, Sendable { case string, number, boolean }

public struct FieldSpec: Sendable {
    public let type: FieldType
    /// Label in the confirmation card; `nil` for fields not worth showing.
    public let label: String?
    /// Render as USD currency in the confirmation card.
    public let usd: Bool
    /// Allowed values (exact match) for enum-like strings.
    public let oneOf: [String]?
    /// Regex the string value must match in full.
    public let pattern: String?
    /// Inclusive bounds for numbers.
    public let min: Double?
    public let max: Double?
    public let optional: Bool

    public init(
        type: FieldType,
        label: String? = nil,
        usd: Bool = false,
        oneOf: [String]? = nil,
        pattern: String? = nil,
        min: Double? = nil,
        max: Double? = nil,
        optional: Bool = false
    ) {
        self.type = type
        self.label = label
        self.usd = usd
        self.oneOf = oneOf
        self.pattern = pattern
        self.min = min
        self.max = max
        self.optional = optional
    }
}

public struct ActionSpec: Sendable {
    public let id: String
    public let title: String
    /// Path as passed to the API client — no `/api` prefix.
    public let endpoint: String
    public let method: String
    /// Disabled actions are rejected even when otherwise well-formed.
    public let enabled: Bool
    /// Declaration order is the confirmation-card render order, so this is an
    /// ordered array of pairs rather than a Dictionary, which has none.
    public let fields: [(String, FieldSpec)]
    /// Values the registry ALWAYS sets, whatever the model proposed. A key here
    /// cannot be supplied, overridden or omitted by the payload.
    ///
    /// `execute: true` on the swap is the reason this exists: /api/swaps is one
    /// route serving both phases, and the discriminator deciding whether money
    /// moves must come from the app, not from a model's JSON.
    public let constants: [String: JSONValue]

    public init(
        id: String, title: String, endpoint: String,
        method: String = "POST", enabled: Bool = true,
        fields: [(String, FieldSpec)],
        constants: [String: JSONValue] = [:]
    ) {
        self.id = id
        self.title = title
        self.endpoint = endpoint
        self.method = method
        self.enabled = enabled
        self.fields = fields
        self.constants = constants
    }
}

// MARK: - Server-proposed confirmation

/// The shape the server returns in `requiresConfirmation`. Every field is
/// untrusted input.
public struct Confirmation: Codable, Sendable {
    public let action: String?
    public let endpoint: String
    public let method: String?
    public let body: [String: JSONValue]?
    public let summary: String
    /// Display hint ONLY, and not trusted for anything. The amount that reaches
    /// the confirmation prompt is read back out of the VALIDATED body — see
    /// `ApprovedAction.amountUsd`. A payload claiming $5 while its body carries
    /// $25,000 must not be able to put "$5" above a Face ID sheet.
    public let amountUsd: Double?

    public init(
        action: String?, endpoint: String, method: String?,
        body: [String: JSONValue]?, summary: String, amountUsd: Double?
    ) {
        self.action = action
        self.endpoint = endpoint
        self.method = method
        self.body = body
        self.summary = summary
        self.amountUsd = amountUsd
    }
}

public struct ConfirmationDetail: Sendable, Hashable {
    public let label: String
    public let value: String
}

public enum ResolvedConfirmation: Sendable {
    case ok(
        spec: ActionSpec,
        /// Exactly what will be sent — from the registry, never the raw payload.
        endpoint: String,
        method: String,
        body: [String: JSONValue],
        details: [ConfirmationDetail],
        amountUsd: Double?
    )
    case rejected(reason: String)
}

// MARK: - Registry

public enum GuardianActionRegistry {

    /// Per-action USD ceiling — a co-pilot/voice confirmation is a convenience
    /// path, not the place for outsized transfers. Anything bigger goes through
    /// the full phone UI flow.
    ///
    /// Must equal MAX_ACTION_USD in copilotActions.ts and GuardianActionRegistry.kt.
    public static let maxActionUsd: Double = 25_000

    private static let evmAddress = "^0x[0-9a-fA-F]{40}$"
    private static let stable = ["USDC", "USDT", "EURC", "PYUSD", "DAI"]
    private static let chains = ["arbitrum", "base", "polygon", "ethereum", "solana"]

    /// The complete allowlist. Ported 1:1 from the Kotlin registry; ids,
    /// endpoints, field names, patterns, enums and bounds must not drift from it.
    public static let actions: [ActionSpec] = [
        ActionSpec(
            id: "card_control",
            title: "Card control",
            endpoint: "/cards/settings",
            fields: [
                ("cardId", FieldSpec(type: .string, label: "Card", pattern: "^[\\w-]{1,64}$")),
                // `freeze`, NOT `frozen`. /api/cards/settings reads body.freeze
                // and the field is optional there, so the wrong name produces a
                // 200 with an unchanged card — a freeze that reports success and
                // does nothing.
                ("freeze", FieldSpec(type: .boolean, label: "Freeze")),
            ]
        ),
        ActionSpec(
            id: "earn_deposit",
            title: "Deposit into Earn",
            endpoint: "/earn/deposit",
            fields: [
                ("token", FieldSpec(type: .string, label: "Token", oneOf: stable)),
                ("amountUsd", FieldSpec(type: .number, label: "Amount", usd: true,
                                        min: 0.01, max: maxActionUsd)),
            ]
        ),
        ActionSpec(
            id: "schedule_dca",
            title: "Recurring investment",
            endpoint: "/investing/schedule",
            fields: [
                // Tighter than place_order's: /api/investing/schedule enforces
                // ^[A-Z]{1,5}$ and rejects anything else.
                ("symbol", FieldSpec(type: .string, label: "Asset", pattern: "^[A-Z]{1,5}$")),
                ("side", FieldSpec(type: .string, label: "Side", oneOf: ["buy", "sell"])),
                ("notional", FieldSpec(type: .number, label: "Amount", usd: true,
                                       min: 1, max: maxActionUsd)),
                ("cadence", FieldSpec(type: .string, label: "Every",
                                      oneOf: ["day", "week", "month"])),
            ]
        ),
        ActionSpec(
            id: "place_order",
            title: "Investment order",
            endpoint: "/investing/order",
            fields: [
                ("symbol", FieldSpec(type: .string, label: "Asset", pattern: "^[A-Z0-9.]{1,12}$")),
                ("side", FieldSpec(type: .string, label: "Side", oneOf: ["buy", "sell"])),
                // `notional`, NOT `notionalUsd`. /api/investing/order requires
                // exactly one of notional/qty and 400s without either.
                ("notional", FieldSpec(type: .number, label: "Amount", usd: true,
                                       min: 1, max: maxActionUsd)),
            ]
        ),
        ActionSpec(
            id: "execute_swap",
            title: "Swap",
            endpoint: "/swaps",
            fields: [
                // The single-use id the server issued for the quote the user was
                // shown. It is the ONLY field the execute phase acts on: the
                // amount, route and rate all come from the stored quote, so
                // re-pricing at execution time is not expressible.
                ("quoteId", FieldSpec(type: .string,
                                      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-"
                                             + "[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")),
                // Display-only echoes of the quoted pair. Accepted and ignored
                // by the server; present so the confirmation card can show the
                // user what they are settling.
                ("fromToken", FieldSpec(type: .string, label: "From", oneOf: stable, optional: true)),
                ("toToken", FieldSpec(type: .string, label: "To", oneOf: stable, optional: true)),
                ("amountIn", FieldSpec(type: .number, label: "Amount", usd: true,
                                       min: 0.01, max: maxActionUsd, optional: true)),
            ],
            // Without this the request is a QUOTE, not an execution: /api/swaps
            // branches on `execute` and silently returns a fresh quote instead
            // of settling. The user confirms a swap and nothing moves.
            constants: ["execute": .bool(true)]
        ),
        ActionSpec(
            id: "send_payment",
            title: "Send payment",
            endpoint: "/payments/create",
            fields: [
                ("amount", FieldSpec(type: .number, label: "Amount", usd: true,
                                     min: 0.01, max: maxActionUsd)),
                ("recipient", FieldSpec(type: .string, label: "Recipient", pattern: evmAddress)),
                ("sourceChain", FieldSpec(type: .string, label: "Chain", oneOf: chains)),
            ]
        ),
        ActionSpec(
            id: "create_support_ticket",
            title: "Open a support ticket",
            endpoint: "/support/tickets",
            fields: [
                ("category", FieldSpec(
                    type: .string, label: "Category",
                    oneOf: ["stablecoins", "cards", "kyc", "travel", "developers", "other"]
                )),
                ("subject", FieldSpec(type: .string, label: "Subject",
                                      pattern: "^[\\s\\S]{4,120}$")),
                // Server minimum is 10, not 1 — a shorter body 400s.
                ("body", FieldSpec(type: .string, pattern: "^[\\s\\S]{10,5000}$")),
            ]
        ),
    ]

    private static let byId: [String: ActionSpec] = Dictionary(
        uniqueKeysWithValues: actions.map { ($0.id, $0) }
    )

    /// Normalises the endpoint for comparison. The model may or may not send a
    /// leading slash or an `/api` prefix; neither difference should reject an
    /// otherwise-valid action, and neither should be trusted to *select* one.
    private static func normalise(_ endpoint: String) -> String {
        var path = endpoint.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let range = path.range(of: "://") {
            // Strip scheme+host if the model sent an absolute URL.
            path = String(path[range.upperBound...])
            path = String(path.drop(while: { $0 != "/" }))
        }
        if path.hasPrefix("/api/") { path = String(path.dropFirst(4)) }
        if !path.hasPrefix("/") { path = "/" + path }
        while path.count > 1 && path.hasSuffix("/") { path = String(path.dropLast()) }
        return path
    }

    /// Resolve an untrusted server confirmation into something executable, or
    /// reject it. This is the only path by which an AI-proposed action may
    /// reach the network layer.
    public static func resolve(_ confirmation: Confirmation) -> ResolvedConfirmation {
        // 1. The action id must name a registered spec. An unknown or absent id
        //    is rejected outright rather than inferred from the endpoint —
        //    inferring would let a crafted endpoint select a spec.
        guard let id = confirmation.action?.trimmingCharacters(in: .whitespacesAndNewlines),
              !id.isEmpty else {
            return .rejected(reason: "No action id was supplied.")
        }
        guard let spec = byId[id] else {
            return .rejected(reason: "Unknown action '\(id)'.")
        }
        guard spec.enabled else {
            return .rejected(reason: "Action '\(id)' is disabled.")
        }

        // 2. The endpoint the server proposed must agree with the registry.
        //    We still send the registry's copy, not this one.
        guard normalise(confirmation.endpoint) == normalise(spec.endpoint) else {
            return .rejected(
                reason: "Endpoint '\(confirmation.endpoint)' does not match '\(spec.endpoint)'."
            )
        }

        // 3. Method likewise. A missing method means the default, matching the
        //    `c.method ?: "POST"` the other two registries apply — absent is not
        //    the same as "any".
        let method = confirmation.method ?? spec.method
        guard method.uppercased() == spec.method.uppercased() else {
            return .rejected(reason: "Method '\(method)' does not match '\(spec.method)'.")
        }

        // 4. A body is mandatory. Treating a missing one as `{}` would let an
        //    action whose fields are all optional through with no payload at
        //    all; the other two registries reject it outright.
        guard let proposed = confirmation.body else {
            return .rejected(reason: "Malformed confirmation body.")
        }

        // 5. Rebuild the body from the spec. Fields the model sent that are not
        //    declared here are silently dropped — they never reach the wire.
        var body: [String: JSONValue] = [:]
        var details: [ConfirmationDetail] = []
        /// The amount that will actually be sent, harvested from the validated
        /// fields. This — not `confirmation.amountUsd` — is what the biometric
        /// prompt shows.
        var validatedAmountUsd: Double?

        for (key, field) in spec.fields {
            guard let raw = proposed[key], raw != .null else {
                if field.optional { continue }
                return .rejected(reason: "Missing required field '\(key)'.")
            }

            switch field.type {
            case .string:
                guard let value = raw.stringValue else {
                    return .rejected(reason: "Field '\(key)' must be a string.")
                }
                // Exact match, as in the TS and Kotlin registries. Comparing
                // case-insensitively while forwarding the original spelling
                // would send a value the server's own enum rejects.
                if let allowed = field.oneOf, !allowed.contains(value) {
                    return .rejected(
                        reason: "Field '\(key)' must be one of \(allowed.joined(separator: ", "))."
                    )
                }
                if let pattern = field.pattern {
                    // Anchored: a partial match must not be accepted.
                    let range = value.range(of: pattern, options: .regularExpression)
                    guard range == value.startIndex..<value.endIndex else {
                        return .rejected(reason: "Field '\(key)' has an invalid format.")
                    }
                }
                body[key] = .string(value)
                if let label = field.label {
                    details.append(ConfirmationDetail(label: label, value: value))
                }

            case .number:
                guard let value = raw.doubleValue, value.isFinite else {
                    return .rejected(reason: "Field '\(key)' must be a number.")
                }
                if let min = field.min, value < min {
                    return .rejected(reason: "Field '\(key)' must be at least \(min).")
                }
                if let max = field.max, value > max {
                    return .rejected(
                        reason: "That amount is above the co-pilot limit — use the full flow instead."
                    )
                }
                body[key] = .number(value)
                if field.usd { validatedAmountUsd = value }
                if let label = field.label {
                    let text = field.usd ? formatUsd(value) : value.formatted()
                    details.append(ConfirmationDetail(label: label, value: text))
                }

            case .boolean:
                guard let value = raw.boolValue else {
                    return .rejected(reason: "Field '\(key)' must be true or false.")
                }
                body[key] = .bool(value)
                if let label = field.label {
                    details.append(ConfirmationDetail(label: label, value: value ? "Yes" : "No"))
                }
            }
        }

        // 6. Registry-owned constants last, so nothing validated above can have
        //    shadowed one.
        for (key, value) in spec.constants {
            body[key] = value
        }

        return .ok(
            spec: spec,
            endpoint: spec.endpoint,   // registry's, never the payload's
            method: spec.method,
            body: body,
            details: details,
            amountUsd: validatedAmountUsd
        )
    }

    /// "$25,000" / "$87.30" — mirrors the `toLocaleString("en-US")` formatting
    /// in copilotActions.ts, and is locale-independent on purpose: the amount
    /// above a Face ID prompt must read the same way in every region.
    static func formatUsd(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        let text = formatter.string(from: NSNumber(value: value)) ?? String(value)
        return "$" + text
    }
}

// MARK: - Minimal JSON value

/// `Any`-free JSON so the whole registry stays `Sendable` under strict
/// concurrency. `[String: Any]` would force an `@unchecked Sendable` escape
/// hatch on the exact type carrying untrusted input, which is the last place
/// that should be opting out of the compiler's help.
public enum JSONValue: Codable, Sendable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    indirect case array([JSONValue])
    indirect case object([String: JSONValue])

    /// Strictly the string case.
    ///
    /// Coercing a number or bool here would mean `{"recipient": 42}` arriving at
    /// a pattern check as "42.0" instead of being rejected as the wrong type —
    /// and the TS registry rejects it on `typeof value !== field.type`, so
    /// coercing would also be drift.
    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    /// Strictly the number case. A model that sends "50" instead of 50 is
    /// sending a string where the schema says number, and both other registries
    /// reject that (`prim.isString` in Kotlin, `typeof` in TS).
    public var doubleValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    /// Strictly the bool case, for the same reason.
    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}
