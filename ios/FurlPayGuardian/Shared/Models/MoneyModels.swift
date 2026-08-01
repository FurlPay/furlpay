//
//  MoneyModels.swift
//
//  Domain models for the money-movement screens ported from native-app:
//  send, swap, earn, bills, off-ramp, credit and banking.
//
//  Field names and shapes follow the RN interfaces exactly, because these
//  decode the SAME server responses. Renaming for Swift taste here would just
//  add CodingKeys to every type and a class of bug where a field silently
//  arrives nil.
//

import Foundation

// MARK: - Transfer

public struct TransferResult: Codable, Sendable, Hashable {
    public let id: String
    public let status: String
    public let amountUsd: Decimal
    public let destination: String
    public let txHash: String?
    public let at: Date?
}

// MARK: - Swap

public struct SwapQuote: Codable, Sendable, Hashable {
    /// Server-issued and SINGLE USE. The client must never re-quote at execute
    /// time — the quote the user approved is the quote that executes, which is
    /// the whole reason this id exists rather than a price.
    public let quoteId: String
    public let fromAsset: String
    public let toAsset: String
    public let fromChain: String?
    public let toChain: String?
    public let amountIn: Decimal
    public let amountOut: Decimal
    public let rate: Decimal?
    public let slippagePct: Double
    public let priceImpactPct: Double?
    public let feeUsd: Decimal?
    public let estimatedSeconds: Int?
    public let expiresAt: Date?

    /// A quote past its expiry must not be executable. The server enforces
    /// this too; checking here means the user sees why instead of a failure.
    public func isExpired(at now: Date = Date()) -> Bool {
        guard let expiresAt else { return false }
        return now >= expiresAt
    }
}

public struct SwapExecution: Codable, Sendable, Hashable {
    public let id: String
    public let status: String
    public let fromAsset: String
    public let toAsset: String
    public let amountIn: Decimal
    public let amountOut: Decimal
    public let txHash: String?
}

// MARK: - Earn

public struct EarnVault: Identifiable, Codable, Sendable, Hashable {
    public var id: String { address }
    public let address: String
    public let name: String
    public let netApy: Double
    public let tvlUsd: Decimal?
    public let curator: String?
    public let risk: String?
}

public struct EarnPosition: Identifiable, Codable, Sendable, Hashable {
    public var id: String { vault }
    public let vault: String
    public let vaultName: String
    public let apy: Double
    public let principalUsd: Decimal
    public let currentValueUsd: Decimal
    public let earnedUsd: Decimal
    public let days: Int
}

public struct EarnSummary: Codable, Sendable, Hashable {
    public let totalPrincipal: Decimal?
    public let totalValue: Decimal?
    public let totalEarned: Decimal?
    public let blendedApy: Double?
}

public struct EarnOverview: Codable, Sendable, Hashable {
    /// False when the server is serving indicative data rather than real
    /// positions. Surfaced to the user rather than hidden — an APY that is not
    /// live is a different claim.
    public let live: Bool
    public let vaults: [EarnVault]
    public let positions: [EarnPosition]
    public let summary: EarnSummary
    public let idleUsdc: Decimal
    public let bestApy: Double
    public let disclosure: String

    public static let empty = EarnOverview(
        live: false, vaults: [], positions: [],
        summary: EarnSummary(totalPrincipal: nil, totalValue: nil,
                             totalEarned: nil, blendedApy: nil),
        idleUsdc: 0, bestApy: 0, disclosure: ""
    )
}

// MARK: - Bills

public struct Bill: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let provider: String
    public let category: String
    public let balanceDue: Decimal
    public let dueDate: String
    public let autopay: Bool

    public var categoryLabel: String {
        switch category {
        case "utility":     "Utility"
        case "credit-card": "Credit card"
        case "mortgage":    "Mortgage"
        case "loan":        "Loan"
        case "telecom":     "Telecom"
        default:            category.capitalized
        }
    }

    /// Whole days until due, rounding UP — a bill due in six hours is "due
    /// today", not "due in 0 days".
    public func daysUntilDue(from now: Date = Date()) -> Int? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let due = formatter.date(from: dueDate)
            ?? ISO8601DateFormatter().date(from: dueDate)
        else { return nil }
        return Int(ceil(due.timeIntervalSince(now) / 86_400))
    }

    public var isOverdue: Bool { (daysUntilDue() ?? 1) < 0 }
}

// MARK: - Off-ramp

public struct FxQuote: Codable, Sendable, Hashable {
    public let amountTo: Decimal
    public let feePct: Double
    public let rail: String
    public let midMarketRate: Decimal
    public let savingsVsCompetitorPct: Double
    public let to: String
}

// MARK: - Credit

public struct CreditCollateral: Identifiable, Codable, Sendable, Hashable {
    public var id: String { label }
    public let label: String
    public let kind: String        // stablecoin | crypto | equity
    public let value: Decimal
    public let ltv: Double
    public let borrowable: Decimal
}

public struct CreditLine: Codable, Sendable, Hashable {
    public let apr: Double
    public let totalCollateral: Decimal
    public let borrowingPower: Decimal
    public let drawn: Decimal
    public let available: Decimal
    public let utilizationPct: Double
    public let currentLtvPct: Double
    public let maxLtvPct: Double
    /// Nil when nothing is drawn — there is no health to report on a line with
    /// no debt, and showing "0.0" would read as danger.
    public let healthFactor: Double?
    public let monthlyInterest: Decimal
    public let collateral: [CreditCollateral]

    /// Liquidation proximity, for the health meter. Nil mirrors healthFactor.
    public var healthBand: HealthBand? {
        guard let healthFactor else { return nil }
        if healthFactor >= 2.0 { return .safe }
        if healthFactor >= 1.3 { return .caution }
        return .atRisk
    }

    public enum HealthBand: String, Sendable {
        case safe, caution, atRisk

        public var label: String {
            switch self {
            case .safe:    "Healthy"
            case .caution: "Watch"
            case .atRisk:  "At risk"
            }
        }
    }
}

// MARK: - Banking

public struct BankAccount: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let label: String
    public let currency: String
    /// Already masked by the server. A full account number never reaches the
    /// client, the same rule the passport vault follows.
    public let accountNumberMasked: String?
    public let routingNumberMasked: String?
    public let ibanMasked: String?
    public let bicMasked: String?
    public let bankName: String?
    public let status: String
}

public struct BankingOverview: Codable, Sendable, Hashable {
    public let accounts: [BankAccount]
    public let balanceUsd: Decimal?
    public let pendingUsd: Decimal?

    public static let empty = BankingOverview(accounts: [], balanceUsd: nil, pendingUsd: nil)
}
