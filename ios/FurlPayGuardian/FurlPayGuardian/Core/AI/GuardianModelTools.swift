//
//  GuardianModelTools.swift
//
//  Bridges the GuardianTools catalog onto the FoundationModels `Tool` protocol.
//  Replaces the FunctionDeclaration mapping in GeminiTextAssistant.kt.
//
//  THE SECURITY SHAPE, WHICH IS THE POINT OF THIS FILE:
//
//  Only READ tools are exposed to the model. freezeCard and setReminder are in
//  the catalog and reachable through the deterministic parser — where the user
//  said the words themselves and a Face ID prompt follows — but they are NOT
//  handed to the model. A model that can call freezeCard is a model that can be
//  talked into calling freezeCard, and the strongest mitigation available is
//  simply not to offer it.
//
//  Every number these return comes from a repository via RepositoryToolExecutor.
//  The model phrases; it never sources.
//

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum GuardianModelTools {

    /// The read-only subset, instantiated against a live container.
    ///
    /// Derived from the catalog rather than listed by hand, so a tool added to
    /// GuardianTools is either exposed or explicitly excluded — it cannot be
    /// forgotten into existence.
    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    @MainActor
    static func all(container: ServiceContainer) -> [any Tool] {
        GuardianTools.all
            .filter { !$0.mutating }
            .map { GuardianReadTool(spec: $0, container: container) }
    }
    #endif
}

#if canImport(FoundationModels)

/// One catalog entry, exposed to the model.
///
/// Generic over the spec rather than one type per tool: the descriptions the
/// model reasons about already live in GuardianTools, and duplicating them here
/// would let the two drift.
@available(iOS 26.0, *)
struct GuardianReadTool: Tool {

    let spec: GuardianTool
    let container: ServiceContainer

    var name: String { spec.name }
    var description: String { spec.description }

    /// The model supplies at most a currency and a period; everything else the
    /// read tools need comes from the repositories.
    ///
    /// One Arguments type for all read tools because @Generable needs a
    /// concrete schema, and the union is two optional strings. A per-tool
    /// struct would be tidier and is not worth seven near-identical types.
    @Generable
    struct Arguments {
        @Guide(description: "Currency code such as USDC or ETH. Omit for all balances.")
        var currency: String?

        @Guide(description: "One of: today, this_week, this_month.")
        var period: String?
    }

    func call(arguments: Arguments) async throws -> String {
        var args: [String: String] = [:]
        if let currency = arguments.currency, !currency.isEmpty {
            args["currency"] = currency
        }
        if let period = arguments.period, !period.isEmpty {
            args["period"] = period
        }

        let invocation = ToolInvocation(tool: spec, args: args)

        // Belt and braces. `all(container:)` already filtered mutating tools
        // out, but if that filter is ever loosened this refuses rather than
        // executing — the failure mode should be a declined action, never an
        // unconfirmed one.
        guard !invocation.requiresConfirmation else {
            return "That action needs the user to confirm it on their iPhone."
        }

        return await container.tools.execute(invocation).text
    }
}

#endif
