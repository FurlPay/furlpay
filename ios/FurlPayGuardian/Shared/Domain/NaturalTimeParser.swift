//
//  NaturalTimeParser.swift
//
//  Resolves "6pm", "in 20 minutes", "tomorrow at 9" into a Date.
//
//  The Android build left this unresolved — RepositoryToolExecutor.kt stores the
//  raw phrase in `detail` with `startAt = null` and a comment saying "until the
//  phone-side parser resolves it". That parser is this file. Without it a
//  spoken reminder never actually fires, because AlarmScheduler needs a concrete
//  Date to arm anything.
//
//  Deliberately narrow. It returns nil rather than guessing, and the caller
//  falls back to storing the phrase. A reminder that fires at the wrong time is
//  worse than one the user is asked to confirm.
//

import Foundation

public enum NaturalTimeParser {

    /// `nil` means "I could not resolve this confidently" — never a fallback
    /// guess. The caller keeps the raw phrase visible so the user can fix it.
    public static func parse(_ raw: String, relativeTo now: Date = Date()) -> Date? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !text.isEmpty else { return nil }

        return parseISO8601(raw)
            ?? parseRelative(text, from: now)
            ?? parseClockTime(text, from: now)
    }

    // "2026-07-30T18:00:00Z" — what a well-behaved model emits.
    private static func parseISO8601(_ raw: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: raw) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    // "in 20 minutes" / "in 2 hours" / "in 3 days"
    private static let relative = try! NSRegularExpression(
        pattern: #"in (\d+)\s*(min|mins|minute|minutes|hour|hours|hr|hrs|day|days)\b"#
    )

    private static func parseRelative(_ text: String, from now: Date) -> Date? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = relative.firstMatch(in: text, range: range),
              let amountRange = Range(match.range(at: 1), in: text),
              let unitRange = Range(match.range(at: 2), in: text),
              let amount = Int(text[amountRange])
        else { return nil }

        let seconds: TimeInterval
        switch text[unitRange] {
        case "min", "mins", "minute", "minutes": seconds = 60
        case "hour", "hours", "hr", "hrs":       seconds = 60 * 60
        default:                                  seconds = 24 * 60 * 60
        }
        return now.addingTimeInterval(TimeInterval(amount) * seconds)
    }

    // "6pm" / "6:30 pm" / "18:00" / "tomorrow at 9am"
    private static let clock = try! NSRegularExpression(
        pattern: #"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?"#
    )

    private static func parseClockTime(_ text: String, from now: Date) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current

        let range = NSRange(text.startIndex..., in: text)
        guard let match = clock.firstMatch(in: text, range: range),
              let hourRange = Range(match.range(at: 1), in: text),
              var hour = Int(text[hourRange]), hour >= 0, hour <= 23
        else { return nil }

        let minute = Range(match.range(at: 2), in: text)
            .flatMap { Int(text[$0]) } ?? 0
        guard minute >= 0, minute < 60 else { return nil }

        let meridiem = Range(match.range(at: 3), in: text).map { String(text[$0]) }
        switch meridiem {
        case "pm" where hour < 12: hour += 12
        case "am" where hour == 12: hour = 0
        case nil where hour > 23: return nil
        default: break
        }

        let base = text.contains("tomorrow")
            ? calendar.date(byAdding: .day, value: 1, to: now) ?? now
            : now

        var components = calendar.dateComponents([.year, .month, .day], from: base)
        components.hour = hour
        components.minute = minute
        guard let candidate = calendar.date(from: components) else { return nil }

        // A bare "6pm" that has already passed means tomorrow. Scheduling a
        // reminder in the past would fire it instantly or not at all.
        if candidate <= now, !text.contains("tomorrow") {
            return calendar.date(byAdding: .day, value: 1, to: candidate)
        }
        return candidate
    }
}
