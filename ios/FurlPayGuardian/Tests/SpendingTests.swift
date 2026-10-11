//
//  SpendingTests.swift
//
//  The spending rollup answers three surfaces — the voice tool, the tile, and
//  the Spending screen. They read one function precisely so they cannot
//  disagree; these tests pin that function's edges.
//

import Testing
import Foundation
@testable import FurlPayGuardian

@Suite("Spending period")
struct SpendingPeriodTests {

    @Test("Wire names round-trip", arguments: SpendingPeriod.allCases)
    func roundTrip(period: SpendingPeriod) {
        #expect(SpendingPeriod(wireName: period.wireName) == period)
    }

    @Test("Wire names are the exact strings the API and tool schema use")
    func exactWireNames() {
        // Hardcoded on purpose: a rename must break this test, not the voice
        // tool at runtime.
        #expect(SpendingPeriod.today.wireName == "today")
        #expect(SpendingPeriod.thisWeek.wireName == "this_week")
        #expect(SpendingPeriod.thisMonth.wireName == "this_month")
    }

    @Test("An unknown wire name does not resolve")
    func rejectsUnknown() {
        #expect(SpendingPeriod(wireName: "this_year") == nil)
        #expect(SpendingPeriod(wireName: "thisWeek") == nil)   // camelCase is not the wire form
        #expect(SpendingPeriod(wireName: "") == nil)
    }
}

@Suite("Spending window")
struct SpendingWindowTests {

    @Test("Budget fraction is nil when no budget is set")
    func noBudget() {
        let window = SpendingWindow(totalUsd: 250, transactionCount: 4)
        #expect(window.budgetUsedFraction == nil)
    }

    @Test("Budget fraction is the consumed share")
    func budgetFraction() throws {
        let window = SpendingWindow(totalUsd: 250, transactionCount: 4, budgetUsd: 1000)
        let fraction = try #require(window.budgetUsedFraction)
        #expect(abs(fraction - 0.25) < 0.0001)
    }

    @Test("Over-budget reports above 1 rather than clamping")
    func overBudget() throws {
        // The coach needs to know by how much, not merely that it happened.
        let window = SpendingWindow(totalUsd: 1500, transactionCount: 9, budgetUsd: 1000)
        let fraction = try #require(window.budgetUsedFraction)
        #expect(fraction > 1.0)
    }

    @Test("A zero budget is treated as no budget, not as division by zero")
    func zeroBudget() {
        let window = SpendingWindow(totalUsd: 10, transactionCount: 1, budgetUsd: 0)
        #expect(window.budgetUsedFraction == nil)
    }
}

@Suite("Spending summary")
struct SpendingSummaryTests {

    private func summary(windows: [String: SpendingWindow]?) -> SpendingSummary {
        SpendingSummary(day: 10, week: 70, month: 300, asOf: .now, windows: windows)
    }

    @Test("Window lookup prefers the detailed form")
    func prefersWindows() {
        let detailed = SpendingWindow(totalUsd: 42, transactionCount: 7, topCategory: "Coffee")
        let spending = summary(windows: [SpendingPeriod.today.wireName: detailed])
        #expect(spending.window(.today).totalUsd == 42)
        #expect(spending.window(.today).topCategory == "Coffee")
    }

    @Test("A snapshot written before `windows` existed still answers with its totals")
    func fallsBackToTotals() {
        // The watch and the phone update independently. An older snapshot must
        // degrade to the bare number, not blank the screen.
        let spending = summary(windows: nil)
        #expect(spending.window(.today).totalUsd == 10)
        #expect(spending.window(.thisWeek).totalUsd == 70)
        #expect(spending.window(.thisMonth).totalUsd == 300)
        #expect(spending.window(.today).transactionCount == 0)
    }

    @Test("A summary with only some windows falls back for the rest")
    func partialWindows() {
        let spending = summary(windows: [
            SpendingPeriod.today.wireName: SpendingWindow(totalUsd: 42, transactionCount: 7),
        ])
        #expect(spending.window(.today).totalUsd == 42)
        #expect(spending.window(.thisMonth).totalUsd == 300)
    }

    @Test("The empty summary is all zeroes and does not crash")
    func emptyIsSafe() {
        #expect(SpendingSummary.empty.window(.today).totalUsd == 0)
        #expect(SpendingSummary.empty.window(.thisMonth).budgetUsedFraction == nil)
    }

    @Test("Summaries survive a JSON round trip")
    func codable() throws {
        // This type crosses the WatchConnectivity boundary; a decode failure
        // here would blank the watch's Spending screen.
        let original = summary(windows: [
            SpendingPeriod.today.wireName:
                SpendingWindow(totalUsd: 42.5, transactionCount: 7,
                               topCategory: "Coffee", budgetUsd: 200),
        ])
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(SpendingSummary.self, from: data)
        #expect(decoded.window(.today).totalUsd == 42.5)
        #expect(decoded.window(.today).topCategory == "Coffee")
        #expect(decoded.window(.today).budgetUsedFraction != nil)
    }

    @Test("A summary encoded without windows decodes cleanly")
    func codableBackCompat() throws {
        let data = try JSONEncoder().encode(summary(windows: nil))
        let decoded = try JSONDecoder().decode(SpendingSummary.self, from: data)
        #expect(decoded.windows == nil)
        #expect(decoded.window(.thisWeek).totalUsd == 70)
    }
}
