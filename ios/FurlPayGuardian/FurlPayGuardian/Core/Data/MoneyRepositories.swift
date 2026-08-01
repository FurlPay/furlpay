//
//  MoneyRepositories.swift
//
//  Repositories for the money-movement screens ported from native-app.
//
//  A NOTE ON WHERE AUTHORISATION LIVES. None of these methods prompt for Face
//  ID. Every mutating one is called from a screen that has already gone through
//  `ServiceContainer.confirmAndDispatch` or an explicit gate, and the registry
//  is what decides whether the request is well-formed. Putting a biometric
//  prompt in here as well would mean two prompts for one action, and worse,
//  would make it look as though calling a repository directly were safe.
//

import Foundation

// MARK: - Swap

@MainActor
@Observable
public final class SwapRepository: BaseRepository {
    private let api: FurlPayAPIClient

    public private(set) var quote: SwapQuote?
    public private(set) var isQuoting = false
    public private(set) var quotedAt: Date?

    public init(api: FurlPayAPIClient) { self.api = api }

    public func requestQuote(
        from fromAsset: String, to toAsset: String, amountUsd: Decimal,
        fromChain: String = "arbitrum", toChain: String? = nil
    ) async throws -> SwapQuote {
        isQuoting = true
        defer { isQuoting = false }
        let fresh = try await api.swapQuote(
            fromToken: fromAsset, toToken: toAsset,
            fromChain: fromChain, toChain: toChain, amountIn: amountUsd
        )
        quote = fresh
        quotedAt = Date()
        return fresh
    }

    /// Executes the quote the user approved — nothing else.
    ///
    /// Takes the quote rather than assets and an amount so there is no code
    /// path that can execute a different trade from the one on screen. If the
    /// quote has expired this refuses locally, so the user is told why instead
    /// of receiving a server error they cannot interpret.
    public func execute(_ approved: SwapQuote, idempotencyKey: String) async throws -> SwapExecution {
        guard !approved.isExpired() else {
            throw APIError.http(status: 409, body: "This quote has expired. Get a new one.")
        }
        let execution = try await api.executeSwap(
            quoteId: approved.quoteId, idempotencyKey: idempotencyKey
        )
        quote = nil
        quotedAt = nil
        return execution
    }

    public func clearQuote() {
        quote = nil
        quotedAt = nil
    }

    public func clear() {
        clearQuote()
        lastUpdated = nil
    }
}

// MARK: - Earn

@MainActor
@Observable
public final class EarnRepository: BaseRepository {
    private let api: FurlPayAPIClient

    public private(set) var overview: EarnOverview = .empty

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchEarn() }) { overview = value }
    }

    public func deposit(vault: String, amountUsd: Decimal, idempotencyKey: String) async throws {
        try await api.earnDeposit(
            vault: vault, amountUsd: amountUsd, idempotencyKey: idempotencyKey
        )
        await refresh()
    }

    public func clear() {
        overview = .empty
        lastUpdated = nil
    }

    /// Best available yield, for the dashboard nudge. Nil when there is nothing
    /// idle to put to work — suggesting a deposit to someone with a zero
    /// balance is noise.
    public var idleOpportunity: (idle: Decimal, apy: Double)? {
        guard overview.idleUsdc > 0, overview.bestApy > 0 else { return nil }
        return (overview.idleUsdc, overview.bestApy)
    }
}

// MARK: - Bills

@MainActor
@Observable
public final class BillsRepository: BaseRepository {
    private let api: FurlPayAPIClient

    public private(set) var bills: [Bill] = []

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchBills() }) { bills = value }
    }

    public func pay(_ bill: Bill, amountUsd: Decimal, idempotencyKey: String) async throws {
        try await api.payBill(
            id: bill.id, amountUsd: amountUsd, idempotencyKey: idempotencyKey
        )
        await refresh()
    }

    public func clear() {
        bills = []
        lastUpdated = nil
    }

    /// Overdue first, then soonest. What a bills screen is actually for.
    public var sorted: [Bill] {
        bills.sorted { a, b in
            let da = a.daysUntilDue() ?? Int.max
            let db = b.daysUntilDue() ?? Int.max
            return da < db
        }
    }

    public var dueSoon: [Bill] {
        sorted.filter { ($0.daysUntilDue() ?? Int.max) <= 7 }
    }
}

// MARK: - Off-ramp

@MainActor
@Observable
public final class OffRampRepository {
    private let api: FurlPayAPIClient

    public private(set) var quote: FxQuote?
    public private(set) var isQuoting = false

    public init(api: FurlPayAPIClient) { self.api = api }

    public func requestQuote(amountUsd: Decimal, to currency: String) async throws -> FxQuote {
        isQuoting = true
        defer { isQuoting = false }
        let fresh = try await api.offRampQuote(amountUsd: amountUsd, to: currency)
        quote = fresh
        return fresh
    }

    public func clear() { quote = nil }
}

// MARK: - Credit

@MainActor
@Observable
public final class CreditRepository: BaseRepository {
    private let api: FurlPayAPIClient

    public private(set) var line: CreditLine?

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchCredit() }) { line = value }
    }

    public func clear() {
        line = nil
        lastUpdated = nil
    }
}

// MARK: - Banking

@MainActor
@Observable
public final class BankingRepository: BaseRepository {
    private let api: FurlPayAPIClient

    public private(set) var overview: BankingOverview = .empty

    public init(api: FurlPayAPIClient) { self.api = api }

    public func refresh() async {
        if let value = await load({ try await api.fetchBanking() }) { overview = value }
    }

    public func clear() {
        overview = .empty
        lastUpdated = nil
    }
}
