//
//  EventPrioritisation.swift
//
//  Port of PrioritizeEventsUseCase.kt and GenerateBriefingUseCase.kt.
//
//  The AI can PROPOSE a priority, but the feed the user sees is sorted by a
//  transparent rule so it is predictable and testable. An LLM re-ranking the
//  list on every refresh would be maddening.
//

import Foundation

// MARK: - Prioritisation

public struct PrioritizeEvents: Sendable {

    /// Injected so the whole thing is testable without waiting for a clock.
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
    }

    /// Ordering:
    ///   1. Unacknowledged before acknowledged.
    ///   2. Higher effective priority first.
    ///   3. Sooner `startAt` first.
    ///   4. Title, case-insensitively — a total order, so the feed never
    ///      reshuffles between two equal events on a refresh.
    public func callAsFunction(_ events: [GuardianEvent]) -> [GuardianEvent] {
        let reference = now()
        return events.sorted { a, b in
            if a.acknowledged != b.acknowledged { return !a.acknowledged }

            let pa = effectivePriority(a, at: reference).rank
            let pb = effectivePriority(b, at: reference).rank
            if pa != pb { return pa > pb }

            if a.startAt != b.startAt { return a.startAt < b.startAt }
            return a.title.lowercased() < b.title.lowercased()
        }
    }

    /// The urgency actually used for sorting: never below the model's, but
    /// raised as the clock closes in. An imminent MEDIUM meeting outranks a
    /// HIGH one that is days away.
    public func effectivePriority(_ event: GuardianEvent, at reference: Date) -> EventPriority {
        let urgency = timeUrgency(untilStart: event.startAt.timeIntervalSince(reference))
        return event.priority.rank >= urgency.rank ? event.priority : urgency
    }

    private func timeUrgency(untilStart: TimeInterval) -> EventPriority {
        // Past due counts as critical too — a negative interval falls through
        // the first branch, which is the intended behaviour.
        if untilStart <= 15 * 60 { return .critical }
        if untilStart <= 60 * 60 { return .high }
        if untilStart <= 24 * 60 * 60 { return .medium }
        return .low
    }
}

// MARK: - Morning briefing

/// The AI writes `summary`; the structured fields are computed deterministically
/// from the day's events so the UI never depends on the model getting counts
/// right.
public struct DailyBriefing: Sendable, Hashable {
    public let date: Date
    public let summary: String
    public let eventCount: Int
    public let criticalCount: Int
    /// The single most urgent event to lead with, if any.
    public let topEvent: GuardianEvent?

    public init(
        date: Date, summary: String, eventCount: Int,
        criticalCount: Int, topEvent: GuardianEvent?
    ) {
        self.date = date
        self.summary = summary
        self.eventCount = eventCount
        self.criticalCount = criticalCount
        self.topEvent = topEvent
    }
}

public struct GenerateBriefing: Sendable {
    private let prioritize: PrioritizeEvents
    private let now: @Sendable () -> Date
    private let calendar: Calendar

    public init(
        prioritize: PrioritizeEvents? = nil,
        now: @escaping @Sendable () -> Date = { Date() },
        calendar: Calendar = .current
    ) {
        self.now = now
        self.prioritize = prioritize ?? PrioritizeEvents(now: now)
        self.calendar = calendar
    }

    public func callAsFunction(events: [GuardianEvent], summary: String) -> DailyBriefing {
        let reference = now()
        let active = events.filter { !$0.acknowledged }
        let ordered = prioritize(active)
        return DailyBriefing(
            date: calendar.startOfDay(for: reference),
            summary: summary,
            eventCount: active.count,
            criticalCount: active.filter {
                prioritize.effectivePriority($0, at: reference) == .critical
            }.count,
            topEvent: ordered.first
        )
    }
}
