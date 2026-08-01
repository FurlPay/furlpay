//
//  RepositoryToolExecutor.swift
//
//  Port of RepositoryToolExecutor.kt.
//
//  Runs catalog tools against the real repositories and phrases the answers the
//  way the watch speaks them. All numbers come from repositories — the model
//  never supplies a figure, only the phrasing around it. That split is why a
//  hallucinated balance is not a failure mode here: there is no path by which a
//  model-authored number reaches this text.
//
//  SECURITY: mutating tools go through `confirmMutating`, which the app layer
//  wires to the biometric gate. The default REFUSES, so a mis-wired executor
//  fails closed rather than open.
//

import Foundation

@MainActor
public final class RepositoryToolExecutor {

    private let container: ServiceContainer
    private let now: () -> Date
    private let confirmMutating: (ToolInvocation) async -> Bool

    public init(
        container: ServiceContainer,
        now: @escaping () -> Date = { Date() },
        confirmMutating: @escaping (ToolInvocation) async -> Bool = { _ in false }
    ) {
        self.container = container
        self.now = now
        self.confirmMutating = confirmMutating
    }

    public func execute(_ invocation: ToolInvocation) async -> ToolReply {
        if invocation.requiresConfirmation, await !confirmMutating(invocation) {
            return ToolReply(
                text: "That needs your confirmation on the device — cancelled for now.",
                kind: .error
            )
        }

        switch invocation.tool.name {
        case "checkBalance":  return await checkBalance(invocation.args["currency"])
        case "freezeCard":    return await freezeCard(invocation.args)
        case "getSpending":   return spending(invocation.args["period"])
        case "getPortfolio":  return portfolioOverview()
        case "getNextEvent":  return nextEvent()
        case "setReminder":   return setReminder(invocation.args)
        case "getTravelInfo": return travelInfo()
        default:
            return ToolReply(text: "Unknown tool \"\(invocation.tool.name)\".", kind: .error)
        }
    }

    // MARK: Tools

    private func checkBalance(_ currency: String?) async -> ToolReply {
        guard let overview = container.wallets.overview, !overview.wallets.isEmpty else {
            return ToolReply(text: "I can't check your balance right now.", kind: .error)
        }
        let list = overview.wallets

        guard let currency else {
            let total = list.reduce(Decimal.zero) { $0 + $1.usdValue }
            let top = list.sorted { $0.usdValue > $1.usdValue }.prefix(3)
                .map { "\($0.currency) \(usd($0.usdValue))" }
                .joined(separator: ", ")
            return ToolReply(text: "Total \(usd(total)). Top: \(top).", kind: .wallet)
        }

        let matches = list.filter { $0.currency.caseInsensitiveCompare(currency) == .orderedSame }
        guard !matches.isEmpty else {
            return ToolReply(text: "No \(currency) balance found.", kind: .wallet)
        }
        let units = matches.reduce(Decimal.zero) { $0 + $1.balance }
        let value = matches.reduce(Decimal.zero) { $0 + $1.usdValue }
        return ToolReply(
            text: "Your \(currency) balance is \(trim(units)), worth \(usd(value)).",
            kind: .wallet
        )
    }

    private func freezeCard(_ args: [String: String]) async -> ToolReply {
        guard let last4 = args["last4"] else {
            return ToolReply(text: "Which card? I need the last 4 digits.", kind: .error)
        }
        // Absent or unparseable means freeze. Defaulting the other way would let
        // a garbled argument UNfreeze a card the user meant to lock.
        let freeze = args["freeze"].flatMap(Bool.init) ?? true

        guard let card = container.cards.cards.first(where: { $0.last4 == last4 }) else {
            return ToolReply(text: "No card ending \(last4).", kind: .error)
        }
        do {
            try await container.cards.setFrozen(cardId: card.id, frozen: freeze)
            // Re-read rather than trusting `freeze`: the repository is the only
            // thing that knows whether the server agreed.
            let now = container.cards.cards.first { $0.id == card.id }?.frozen ?? freeze
            return ToolReply(
                text: "Card ending \(last4) is now \(now ? "frozen" : "active").",
                kind: .card
            )
        } catch {
            return ToolReply(text: "I couldn't change that card right now.", kind: .error)
        }
    }

    private func spending(_ periodWire: String?) -> ToolReply {
        let period = SpendingPeriod(wireName: periodWire ?? "today") ?? .today
        let window = container.transactions.spendingSummary.window(period)
        let txWord = window.transactionCount == 1 ? "transaction" : "transactions"
        return ToolReply(
            text: "You've spent \(usd(window.totalUsd)) \(period.spokenLabel) "
                + "across \(window.transactionCount) \(txWord).",
            kind: .spending
        )
    }

    private func portfolioOverview() -> ToolReply {
        guard let p = container.portfolio.summary else {
            return ToolReply(text: "I can't check your portfolio right now.", kind: .error)
        }
        let direction = p.dayChangeUsd >= 0 ? "up" : "down"
        let mover = p.topMover.map {
            " Top mover: \($0.symbol) \(signedPct($0.unrealizedPnlPercent))."
        } ?? ""
        return ToolReply(
            text: "Portfolio \(usd(p.totalUsd)), \(direction) \(usd(abs(p.dayChangeUsd))) "
                + "today (\(signedPct(p.dayChangePercent))).\(mover)",
            kind: .portfolio
        )
    }

    private func nextEvent() -> ToolReply {
        let reference = now()
        guard let next = container.events.active
            .filter({ $0.startAt >= reference })
            .min(by: { $0.startAt < $1.startAt })
        else {
            return ToolReply(text: "Nothing scheduled.", kind: .event)
        }

        let minutes = max(Int(next.startAt.timeIntervalSince(reference) / 60), 0)
        let whenText: String
        if minutes < 60 {
            whenText = "in \(minutes) minutes"
        } else if minutes < 24 * 60 {
            whenText = "in \(minutes / 60)h \(minutes % 60)m"
        } else {
            whenText = "in \(minutes / (24 * 60)) days"
        }
        return ToolReply(text: "\(next.title) \(whenText).", kind: .event)
    }

    private func setReminder(_ args: [String: String]) -> ToolReply {
        guard let title = args["title"] else {
            return ToolReply(text: "What should I remind you about?", kind: .error)
        }
        guard let time = args["time"] else {
            return ToolReply(text: "When should I remind you?", kind: .error)
        }
        let priority: EventPriority = {
            switch args["priority"]?.lowercased() {
            case "critical": return .critical
            case "high":     return .high
            case "low":      return .low
            default:         return .medium
            }
        }()

        // The natural-language time is resolved on the phone, which owns the
        // parser and the alarm ladder. Until then it lives in `detail` — the
        // watch must not invent a Date from "sixish".
        let resolved = NaturalTimeParser.parse(time, relativeTo: now())
        let event = GuardianEvent(
            id: "reminder-\(UUID().uuidString)",
            source: .user,
            title: title,
            detail: resolved == nil ? "Remind at: \(time)" : nil,
            startAt: resolved ?? now().addingTimeInterval(60 * 60),
            priority: priority
        )
        container.events.add(event)
        if resolved != nil {
            Task { await container.alarms.schedule(event) }
        }

        let escalation = priority == .critical ? " I'll escalate until you acknowledge." : ""
        return ToolReply(
            text: "Reminder set: \"\(title)\" at \(time) (\(priority.rawValue)).\(escalation)",
            kind: .event
        )
    }

    private func travelInfo() -> ToolReply {
        guard let next = container.travel.activeTrips.first else {
            return ToolReply(text: "No upcoming trips.", kind: .travel)
        }
        let flight = next.flights?.first
        let detail = flight.map { " \($0.carrier)\($0.flightNumber) to \($0.destination)" }
            ?? (next.hotel.map { " — \($0.name)" } ?? "")
        return ToolReply(
            text: "\(next.destination)\(detail). "
                + "Departs \(next.startDate.formatted(date: .abbreviated, time: .shortened)).",
            kind: .travel
        )
    }

    // MARK: Formatting
    //
    // Locale-fixed to en_US on purpose: these strings are compared in tests and
    // spoken by a US-English voice. A device in a comma-decimal locale must not
    // silently change the wording.

    private func usd(_ n: Decimal) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        let value = formatter.string(from: n as NSDecimalNumber) ?? "0.00"
        return "$" + value
    }

    private func signedPct(_ pct: Double) -> String {
        (pct >= 0 ? "+" : "") + String(format: "%.1f", pct) + "%"
    }

    private func trim(_ n: Decimal) -> String {
        let number = n as NSDecimalNumber
        if n == n.rounded(0, .down) { return number.stringValue }
        var text = String(format: "%.4f", number.doubleValue)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
}

private extension Decimal {
    func rounded(_ scale: Int, _ mode: NSDecimalNumber.RoundingMode) -> Decimal {
        var source = self
        var result = Decimal()
        NSDecimalRound(&result, &source, scale, mode)
        return result
    }
}
