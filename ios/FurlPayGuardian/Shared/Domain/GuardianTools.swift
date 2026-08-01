//
//  GuardianTools.swift
//
//  Port of GuardianTool.kt and GuardianToolExecutor.kt.
//
//  Provider-neutral declaration of the voice/agent tool surface. Whatever model
//  layer is bolted on later — FoundationModels, a hosted model, App Intents —
//  maps onto THIS catalog rather than declaring its own. One testable source of
//  truth beats a tool surface duplicated per provider and quietly drifting.
//
//  SECURITY: `mutating` tools must be confirmed by the human before execution.
//  "The model asked" is never authorization. The catalog only marks them; the
//  refusal is enforced in the executor and, for anything that reaches the
//  network, again in ActionRegistry.
//

import Foundation

public enum ParamType: String, Sendable { case string, boolean, integer }

public struct ToolParam: Sendable, Hashable {
    public let name: String
    public let type: ParamType
    public let required: Bool
    public let description: String

    public init(_ name: String, _ type: ParamType, required: Bool, _ description: String) {
        self.name = name
        self.type = type
        self.required = required
        self.description = description
    }
}

public struct GuardianTool: Sendable, Hashable {
    public let name: String
    public let description: String
    public let params: [ToolParam]
    public let mutating: Bool
}

/// The canonical Guardian tool catalog. Mirrors the voice-command schema.
public enum GuardianTools {

    public static let all: [GuardianTool] = [
        GuardianTool(
            name: "checkBalance",
            description: "Check wallet balances. Returns balances for all currencies or a specific one.",
            params: [
                ToolParam("currency", .string, required: false, "Currency code, e.g. USDC. Omit for all."),
            ],
            mutating: false
        ),
        GuardianTool(
            name: "freezeCard",
            description: "Freeze or unfreeze a FurlPay card. Requires the card's last 4 digits.",
            params: [
                ToolParam("last4", .string, required: true, "Last 4 digits of the card."),
                ToolParam("freeze", .boolean, required: true, "true to freeze, false to unfreeze."),
            ],
            mutating: true
        ),
        GuardianTool(
            name: "getSpending",
            description: "Get spending breakdown for a period: today, this_week, or this_month.",
            params: [
                ToolParam("period", .string, required: true, "One of: today, this_week, this_month."),
            ],
            mutating: false
        ),
        GuardianTool(
            name: "getPortfolio",
            description: "Get investment portfolio value, daily change, and top movers.",
            params: [],
            mutating: false
        ),
        GuardianTool(
            name: "getNextEvent",
            description: "Get the next upcoming event, meeting, or deadline.",
            params: [],
            mutating: false
        ),
        GuardianTool(
            name: "setReminder",
            description: "Set a reminder with a title, time, and priority (critical/high/medium/low).",
            params: [
                ToolParam("title", .string, required: true, "What to remind the user about."),
                ToolParam("time", .string, required: true, "When — ISO 8601 or natural language."),
                ToolParam("priority", .string, required: true, "critical, high, medium, or low."),
            ],
            mutating: true
        ),
        GuardianTool(
            name: "getTravelInfo",
            description: "Get upcoming travel: next flight details, hotel bookings, boarding passes.",
            params: [],
            mutating: false
        ),
    ]

    public static func byName(_ name: String) -> GuardianTool? {
        all.first { $0.name == name }
    }

    /// Tools that must be human-confirmed before dispatch.
    public static let mutating: Set<String> =
        Set(all.filter(\.mutating).map(\.name))
}

// MARK: - Invocation

/// A parsed intent: which catalog tool to run and with what arguments.
public struct ToolInvocation: Sendable, Hashable {
    public let tool: GuardianTool
    public let args: [String: String]

    public init(tool: GuardianTool, args: [String: String] = [:]) {
        self.tool = tool
        self.args = args
    }

    public var requiresConfirmation: Bool { tool.mutating }
}

/// What a tool run says back — the text the watch shows and speaks, plus a
/// domain hint for the response icon.
public struct ToolReply: Sendable, Hashable {
    public enum Kind: String, Sendable {
        case generic, wallet, card, event, travel, portfolio, spending, error
    }

    public let text: String
    public let kind: Kind

    public init(text: String, kind: Kind = .generic) {
        self.text = text
        self.kind = kind
    }
}

/// Executes catalog tools. Implemented in the app layer, which owns the
/// repositories and the biometric gate.
///
/// CONTRACT: implementations MUST refuse mutating tools unless the human has
/// confirmed. `ToolInvocation.requiresConfirmation` marks them.
public protocol GuardianToolExecuting: Sendable {
    func execute(_ invocation: ToolInvocation, confirmed: Bool) async -> ToolReply
}
