//
//  VoiceCommandParser.swift
//
//  Port of VoiceCommandParser.kt.
//
//  Deterministic first-pass voice intent parser. The watch's voice commands
//  follow a tight schema ("what's my balance", "freeze my card ending 4521"),
//  and for those the answer must not depend on a model being reachable — the
//  rule decides, the model is only the fallback for phrasing the rules do not
//  cover. Returns nil when no rule matches; the caller escalates.
//
//  This is what makes the watch useful with the phone in another room.
//

import Foundation

public enum VoiceCommandParser {

    private static let knownCurrencies =
        ["USDC", "USDT", "EURC", "PYUSD", "DAI", "ETH", "SOL", "BTC", "USD", "EUR"]

    /// Compiled once. Building an NSRegularExpression per utterance would be
    /// wasteful on a watch, where this runs on the tap-to-talk path.
    private static let last4 = try! NSRegularExpression(pattern: #"\b(\d{4})\b"#)
    private static let reminder = try! NSRegularExpression(
        pattern: #"remind me to (.+?)(?: at | by | on )(.+)"#,
        options: [.caseInsensitive]
    )

    public static func parse(_ raw: String) -> ToolInvocation? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !text.isEmpty else { return nil }

        // Order matters: freeze is checked first so "freeze my card, how much
        // have I spent" cannot be swallowed by the spending rule.
        return parseFreeze(text)
            ?? parseSpending(text)
            ?? parseBalance(text)
            ?? parsePortfolio(text)
            ?? parseTravel(text)
            ?? parseNextEvent(text)
            ?? parseReminder(raw)
    }

    private static func tool(_ name: String) -> GuardianTool {
        guard let tool = GuardianTools.byName(name) else {
            preconditionFailure("Tool \(name) missing from catalog")
        }
        return tool
    }

    // "freeze my card ending 4521" / "unfreeze my visa 4521" / "lock card 4521"
    private static func parseFreeze(_ text: String) -> ToolInvocation? {
        let mentionsCard = text.contains("card") || text.contains("visa") || text.contains("mastercard")
        let freezes = text.contains("freeze") || text.contains("lock")
        guard mentionsCard, freezes else { return nil }

        // Without the last4 we refuse to guess which card. Never freeze "some"
        // card — the UI or the model path must disambiguate.
        guard let digits = firstGroup(of: last4, in: text) else { return nil }

        let unfreeze = text.contains("unfreeze") || text.contains("unlock")
        return ToolInvocation(
            tool: tool("freezeCard"),
            args: ["last4": digits, "freeze": String(!unfreeze)]
        )
    }

    // "how much did I spend today" / "what's my weekly spend"
    private static func parseSpending(_ text: String) -> ToolInvocation? {
        guard text.contains("spend") || text.contains("spent") || text.contains("spending")
        else { return nil }

        let period: String
        if text.contains("week") { period = "this_week" }
        else if text.contains("month") { period = "this_month" }
        else { period = "today" }

        return ToolInvocation(tool: tool("getSpending"), args: ["period": period])
    }

    // "what's my balance" / "how much ETH do I have"
    private static func parseBalance(_ text: String) -> ToolInvocation? {
        let asksBalance = text.contains("balance")
            || ((text.contains("how much") || text.contains("how many"))
                && (text.contains("have") || text.contains("hold")))
        guard asksBalance else { return nil }

        let currency = knownCurrencies.first { text.contains($0.lowercased()) }
        return ToolInvocation(
            tool: tool("checkBalance"),
            args: currency.map { ["currency": $0] } ?? [:]
        )
    }

    // "how are my investments" / "portfolio"
    private static func parsePortfolio(_ text: String) -> ToolInvocation? {
        guard text.contains("portfolio") || text.contains("investment") || text.contains("stocks")
        else { return nil }
        return ToolInvocation(tool: tool("getPortfolio"))
    }

    // "when's my next flight" / "hotel check-in info"
    private static func parseTravel(_ text: String) -> ToolInvocation? {
        let words = ["flight", "hotel", "trip", "travel", "check-in", "boarding"]
        guard words.contains(where: text.contains) else { return nil }
        return ToolInvocation(tool: tool("getTravelInfo"))
    }

    // "what's my next meeting" / "what do I have today"
    private static func parseNextEvent(_ text: String) -> ToolInvocation? {
        let words = ["next meeting", "next event", "calendar", "schedule", "what do i have"]
        guard words.contains(where: text.contains) else { return nil }
        return ToolInvocation(tool: tool("getNextEvent"))
    }

    // "remind me to call Mom at 6pm" — keeps the ORIGINAL casing for the title,
    // so the reminder reads "Call Mom", not "call mom".
    private static func parseReminder(_ raw: String) -> ToolInvocation? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        guard let match = reminder.firstMatch(in: trimmed, range: range),
              match.numberOfRanges >= 3,
              let titleRange = Range(match.range(at: 1), in: trimmed),
              let timeRange = Range(match.range(at: 2), in: trimmed)
        else { return nil }

        let lower = raw.lowercased()
        let priority: String
        if lower.contains("critical") || lower.contains("urgent") { priority = "critical" }
        else if lower.contains("important") { priority = "high" }
        else { priority = "medium" }

        return ToolInvocation(
            tool: tool("setReminder"),
            args: [
                "title": String(trimmed[titleRange]).trimmingCharacters(in: .whitespaces),
                "time": String(trimmed[timeRange]).trimmingCharacters(in: .whitespaces),
                "priority": priority,
            ]
        )
    }

    private static func firstGroup(
        of regex: NSRegularExpression, in text: String
    ) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges >= 2,
              let group = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[group])
    }
}
