//
//  DomainTests.swift
//
//  Covers the pure domain logic ported from core/domain: the guardian score,
//  event prioritisation, the briefing, and the voice parser. These are the
//  files where a silent behavioural difference from Android would be invisible
//  until a user noticed their watch and their phone disagreed.
//

import Testing
import Foundation
@testable import FurlPayGuardian

// MARK: - Guardian score

@Suite("Guardian score")
struct GuardianScoreTests {

    private func rising(_ count: Int) -> [Double] {
        (0..<count).map { 100.0 * pow(1.01, Double($0)) }
    }

    private func falling(_ count: Int) -> [Double] {
        (0..<count).map { 100.0 * pow(0.99, Double($0)) }
    }

    @Test("Too little history returns nothing rather than a guess")
    func refusesThinData() {
        #expect(ComputeGuardianScore.callAsFunction(closes: [1, 2, 3], timeframe: "1D") == nil)
        #expect(ComputeGuardianScore.callAsFunction(closes: [], timeframe: "1D") == nil)
        // 7 bars is one below the minimum.
        #expect(ComputeGuardianScore.callAsFunction(closes: rising(7), timeframe: "1D") == nil)
        #expect(ComputeGuardianScore.callAsFunction(closes: rising(8), timeframe: "1D") != nil)
    }

    @Test("Non-positive closes are rejected — a zero price is bad data, not a signal")
    func rejectsBadPrices() {
        var closes = rising(12)
        closes[5] = 0
        #expect(ComputeGuardianScore.callAsFunction(closes: closes, timeframe: "1D") == nil)

        closes[5] = -3
        #expect(ComputeGuardianScore.callAsFunction(closes: closes, timeframe: "1D") == nil)
    }

    @Test("A steadily rising series scores buy; a falling one scores sell")
    func directionality() throws {
        let up = try #require(ComputeGuardianScore.callAsFunction(closes: rising(30), timeframe: "1M"))
        #expect(up.stance == .buy)
        #expect(up.score > 62)

        let down = try #require(ComputeGuardianScore.callAsFunction(closes: falling(30), timeframe: "1M"))
        #expect(down.stance == .sell)
        #expect(down.score < 38)
    }

    @Test("The score never leaves 5...95, however extreme the series")
    func scoreIsClamped() throws {
        let explosive = (0..<40).map { 1.0 * pow(2.0, Double($0)) }
        let collapse = (0..<40).map { 1_000_000.0 * pow(0.5, Double($0)) }

        let high = try #require(ComputeGuardianScore.callAsFunction(closes: explosive, timeframe: "1M"))
        let low = try #require(ComputeGuardianScore.callAsFunction(closes: collapse, timeframe: "1M"))
        #expect((5...95).contains(high.score))
        #expect((5...95).contains(low.score))
    }

    @Test("Confidence stays within 40...92 and is damped on short series")
    func confidenceBounds() throws {
        let short = try #require(ComputeGuardianScore.callAsFunction(closes: rising(8), timeframe: "1D"))
        let long = try #require(ComputeGuardianScore.callAsFunction(closes: rising(40), timeframe: "1M"))

        #expect((40...92).contains(short.confidence))
        #expect((40...92).contains(long.confidence))
        // More data, same shape → more confidence. This is the dataFactor.
        #expect(long.confidence > short.confidence)
    }

    @Test("Every score carries its reasoning")
    func alwaysExplains() throws {
        let score = try #require(ComputeGuardianScore.callAsFunction(closes: rising(20), timeframe: "1M"))
        #expect(score.reasons.count == 4)
        #expect(score.reasons.allSatisfy { !$0.isEmpty })
        // The timeframe label is echoed back so the copy matches the chip.
        #expect(score.reasons.contains { $0.contains("1M") })
    }

    @Test("A flat series is low risk; a whipsawing one is high risk")
    func riskTracksVolatility() throws {
        let flat = Array(repeating: 100.0, count: 20)
        // A flat series has zero returns, so momentum is 0 and it is not above
        // its own average — still a valid input.
        let calm = try #require(ComputeGuardianScore.callAsFunction(closes: flat, timeframe: "1D"))
        #expect(calm.risk == .low)

        let choppy = (0..<20).map { $0.isMultiple(of: 2) ? 100.0 : 130.0 }
        let wild = try #require(ComputeGuardianScore.callAsFunction(closes: choppy, timeframe: "1D"))
        #expect(wild.risk == .high)
    }
}

// MARK: - Prioritisation

@Suite("Event prioritisation")
struct PrioritizeEventsTests {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func event(
        _ title: String, _ priority: EventPriority,
        inMinutes: Double, acknowledged: Bool = false
    ) -> GuardianEvent {
        GuardianEvent(
            id: title, source: .user, title: title,
            startAt: now.addingTimeInterval(inMinutes * 60),
            priority: priority, acknowledged: acknowledged
        )
    }

    private var subject: PrioritizeEvents {
        PrioritizeEvents(now: { [now] in now })
    }

    @Test("Unacknowledged events come first regardless of priority")
    func unacknowledgedFirst() {
        let result = subject([
            event("done", .critical, inMinutes: 5, acknowledged: true),
            event("open", .low, inMinutes: 5000),
        ])
        #expect(result.map(\.title) == ["open", "done"])
    }

    @Test("An imminent MEDIUM outranks a distant HIGH")
    func timeUrgencyLifts() {
        // This is the whole point of effective priority.
        let result = subject([
            event("next week", .high, inMinutes: 7 * 24 * 60),
            event("in ten minutes", .medium, inMinutes: 10),
        ])
        #expect(result.first?.title == "in ten minutes")
    }

    @Test("Time urgency never LOWERS a model-supplied priority")
    func urgencyIsAFloorNotACeiling() {
        let distant = event("distant critical", .critical, inMinutes: 30 * 24 * 60)
        #expect(subject.effectivePriority(distant, at: now) == .critical)
    }

    @Test("Urgency bands match the Kotlin thresholds", arguments: [
        (5.0, EventPriority.critical),
        (15.0, EventPriority.critical),
        (16.0, EventPriority.high),
        (60.0, EventPriority.high),
        (61.0, EventPriority.medium),
        (24.0 * 60, EventPriority.medium),
        (24.0 * 60 + 1, EventPriority.low),
    ])
    func urgencyBands(minutes: Double, expected: EventPriority) {
        let lowEvent = event("x", .low, inMinutes: minutes)
        #expect(subject.effectivePriority(lowEvent, at: now) == expected)
    }

    @Test("A past-due event is critical")
    func pastDueIsCritical() {
        let overdue = event("overdue", .low, inMinutes: -120)
        #expect(subject.effectivePriority(overdue, at: now) == .critical)
    }

    @Test("Equal events sort by title, so the feed never reshuffles on refresh")
    func stableOrdering() {
        let events = [
            event("Zebra", .medium, inMinutes: 100),
            event("Apple", .medium, inMinutes: 100),
        ]
        #expect(subject(events).map(\.title) == ["Apple", "Zebra"])
        // Same input, reversed — must produce the same output.
        #expect(subject(events.reversed()).map(\.title) == ["Apple", "Zebra"])
    }

    @Test("An empty feed does not crash")
    func emptyIsSafe() {
        #expect(subject([]).isEmpty)
    }
}

// MARK: - Briefing

@Suite("Daily briefing")
struct GenerateBriefingTests {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func event(_ title: String, inMinutes: Double, acknowledged: Bool = false) -> GuardianEvent {
        GuardianEvent(
            id: title, source: .user, title: title,
            startAt: now.addingTimeInterval(inMinutes * 60),
            priority: .medium, acknowledged: acknowledged
        )
    }

    private var subject: GenerateBriefing {
        GenerateBriefing(now: { [now] in now })
    }

    @Test("Counts exclude acknowledged events")
    func countsActiveOnly() {
        let briefing = subject(
            events: [
                event("a", inMinutes: 30),
                event("b", inMinutes: 300),
                event("done", inMinutes: 10, acknowledged: true),
            ],
            summary: "Morning."
        )
        #expect(briefing.eventCount == 2)
    }

    @Test("Critical count uses effective priority, not the stored one")
    func criticalCountUsesUrgency() {
        // Both are MEDIUM as stored; only the imminent one is effectively
        // critical. A count off the stored field would report zero.
        let briefing = subject(
            events: [event("imminent", inMinutes: 5), event("later", inMinutes: 5000)],
            summary: ""
        )
        #expect(briefing.criticalCount == 1)
    }

    @Test("The lead event is the top of the same ranking the feed uses")
    func topEventMatchesFeed() {
        let events = [event("later", inMinutes: 5000), event("imminent", inMinutes: 5)]
        #expect(subject(events: events, summary: "").topEvent?.title == "imminent")
    }

    @Test("The model's prose is passed through untouched and never drives the numbers")
    func summaryIsOpaque() {
        let briefing = subject(events: [], summary: "You have 47 meetings today.")
        #expect(briefing.summary == "You have 47 meetings today.")
        // The prose claimed 47. The count is computed, so it says 0.
        #expect(briefing.eventCount == 0)
        #expect(briefing.topEvent == nil)
    }
}

// MARK: - Voice parsing

@Suite("Voice command parser")
struct VoiceCommandParserTests {

    @Test("Balance phrasings", arguments: [
        "what's my balance", "how much do I have", "what is my balance right now",
    ])
    func balance(phrase: String) throws {
        let invocation = try #require(VoiceCommandParser.parse(phrase))
        #expect(invocation.tool.name == "checkBalance")
        #expect(invocation.requiresConfirmation == false)
    }

    @Test("A named currency is captured")
    func balanceWithCurrency() throws {
        let invocation = try #require(VoiceCommandParser.parse("how much ETH do I have"))
        #expect(invocation.args["currency"] == "ETH")
    }

    @Test("Freeze needs the last four digits and will not guess")
    func freezeRequiresLast4() throws {
        // No digits — refuses rather than freezing "some" card.
        #expect(VoiceCommandParser.parse("freeze my card") == nil)

        let invocation = try #require(VoiceCommandParser.parse("freeze my card ending 4521"))
        #expect(invocation.tool.name == "freezeCard")
        #expect(invocation.args["last4"] == "4521")
        #expect(invocation.args["freeze"] == "true")
        #expect(invocation.requiresConfirmation, "freezing is mutating")
    }

    @Test("Unfreeze and unlock invert the flag")
    func unfreeze() throws {
        for phrase in ["unfreeze my card 4521", "unlock card 4521"] {
            let invocation = try #require(VoiceCommandParser.parse(phrase))
            #expect(invocation.args["freeze"] == "false", "\(phrase)")
        }
    }

    @Test("Spending periods map to wire names", arguments: [
        ("how much did I spend today", "today"),
        ("what's my weekly spend", "this_week"),
        ("how much have I spent this month", "this_month"),
    ])
    func spendingPeriods(phrase: String, expected: String) throws {
        let invocation = try #require(VoiceCommandParser.parse(phrase))
        #expect(invocation.tool.name == "getSpending")
        #expect(invocation.args["period"] == expected)
    }

    @Test("Reminder keeps the original casing of the title")
    func reminderCasing() throws {
        let invocation = try #require(VoiceCommandParser.parse("remind me to call Mom at 6pm"))
        #expect(invocation.tool.name == "setReminder")
        #expect(invocation.args["title"] == "call Mom")   // not "call mom"
        #expect(invocation.args["time"] == "6pm")
        #expect(invocation.args["priority"] == "medium")
        #expect(invocation.requiresConfirmation)
    }

    @Test("Urgency words lift reminder priority")
    func reminderPriority() throws {
        let urgent = try #require(VoiceCommandParser.parse("remind me to urgent call the bank at 9am"))
        #expect(urgent.args["priority"] == "critical")

        let important = try #require(VoiceCommandParser.parse("remind me to important file taxes on Friday"))
        #expect(important.args["priority"] == "high")
    }

    @Test("Freeze is matched before spending when a phrase mentions both")
    func orderingMatters() throws {
        let invocation = try #require(
            VoiceCommandParser.parse("freeze my card 4521, I've spent too much")
        )
        #expect(invocation.tool.name == "freezeCard")
    }

    @Test("Unmatched phrasing returns nil so the caller can escalate", arguments: [
        "", "   ", "tell me a joke", "what's the weather", "hello",
    ])
    func unmatched(phrase: String) {
        #expect(VoiceCommandParser.parse(phrase) == nil)
    }

    @Test("Every parsed tool exists in the catalog")
    func onlyEmitsCatalogTools() {
        let phrases = [
            "what's my balance", "freeze my card 1234", "how much did I spend today",
            "how's my portfolio", "when's my next flight", "what's my next meeting",
            "remind me to stretch at 3pm",
        ]
        for phrase in phrases {
            guard let invocation = VoiceCommandParser.parse(phrase) else {
                Issue.record("'\(phrase)' should parse")
                continue
            }
            #expect(GuardianTools.byName(invocation.tool.name) != nil)
        }
    }

    @Test("Mutating tools are exactly freezeCard and setReminder")
    func mutatingSet() {
        #expect(GuardianTools.mutating == ["freezeCard", "setReminder"])
    }
}

// MARK: - Natural time

@Suite("Natural time parser")
struct NaturalTimeParserTests {

    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test("Relative offsets", arguments: [
        ("in 20 minutes", 20.0 * 60),
        ("in 2 hours", 2.0 * 3600),
        ("in 3 days", 3.0 * 86400),
    ])
    func relative(phrase: String, seconds: Double) throws {
        let parsed = try #require(NaturalTimeParser.parse(phrase, relativeTo: now))
        #expect(abs(parsed.timeIntervalSince(now) - seconds) < 1)
    }

    @Test("ISO 8601 passes through")
    func iso() throws {
        // Built with a formatter rather than a magic epoch so the expectation
        // is readable and cannot silently encode my own arithmetic error.
        var components = DateComponents()
        components.year = 2026; components.month = 8; components.day = 1
        components.hour = 18; components.minute = 0; components.second = 0
        components.timeZone = TimeZone(identifier: "UTC")
        let expected = try #require(Calendar(identifier: .gregorian).date(from: components))

        let parsed = try #require(NaturalTimeParser.parse("2026-08-01T18:00:00Z", relativeTo: now))
        #expect(parsed == expected)
    }

    @Test("A clock time that has already passed rolls to tomorrow")
    func rollsForward() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        // Pick a reference late in the day, then ask for an early hour.
        let lateToday = calendar.date(bySettingHour: 23, minute: 0, second: 0, of: now)!
        let parsed = try #require(NaturalTimeParser.parse("7am", relativeTo: lateToday))
        #expect(parsed > lateToday, "must be in the future, never the past")
        #expect(parsed.timeIntervalSince(lateToday) < 24 * 3600)
    }

    @Test("Nonsense returns nil rather than a guess", arguments: [
        "", "sixish", "later", "when I get round to it", "next tuesday-ish",
    ])
    func refusesToGuess(phrase: String) {
        #expect(NaturalTimeParser.parse(phrase, relativeTo: now) == nil)
    }
}
