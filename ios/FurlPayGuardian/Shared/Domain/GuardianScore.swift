//
//  GuardianScore.swift
//
//  Port of ComputeGuardianScoreUseCase.kt.
//
//  The watch's "AI take" on an asset, computed from the bars the stock screen
//  already fetched — deterministic signal maths, not an LLM's opinion. This is
//  NOT the server's `AssetDetail.guardianScore` field, which the phone renders
//  when it happens to be present; this one works with no network and no model,
//  which is the whole point on a wrist.
//
//  Kept pure and free of Foundation date handling so it is trivially testable.
//

import Foundation

public struct GuardianScore: Sendable, Hashable {
    public enum Stance: String, Sendable { case buy, hold, sell }
    public enum Risk: String, Sendable { case low, medium, high }

    /// 5...95 — never pretends certainty at the extremes.
    public let score: Int
    public let stance: Stance
    /// 0...100 — how strongly the signals agree, damped on thin data.
    public let confidence: Int
    public let risk: Risk
    /// Human "why" lines, strongest first — the tap-to-expand reasoning.
    public let reasons: [String]
}

public enum ComputeGuardianScore {

    private static let minBars = 8

    /// `closes` oldest→newest for the visible timeframe; `timeframe` is the chip
    /// label ("1M") used in the reasoning copy.
    ///
    /// Returns `nil` when there is not enough history to say anything
    /// defensible — a score derived from three bars would be noise wearing a
    /// number's clothes.
    public static func callAsFunction(closes: [Double], timeframe: String) -> GuardianScore? {
        guard closes.count >= minBars, !closes.contains(where: { $0 <= 0 }) else { return nil }

        let returns = zip(closes, closes.dropFirst()).map { $1 / $0 - 1.0 }
        let momentumPct = (closes.last! / closes.first! - 1.0) * 100.0
        let upShare = Double(returns.filter { $0 > 0 }.count) / Double(returns.count)
        let volPct = stdDev(returns) * 100.0
        let average = closes.reduce(0, +) / Double(closes.count)
        let aboveAverage = closes.last! > average

        let risk: GuardianScore.Risk = {
            if volPct < 1.2 { return .low }
            if volPct < 2.8 { return .medium }
            return .high
        }()

        let riskPenalty: Double = {
            switch risk {
            case .low:    return 0
            case .medium: return 4
            case .high:   return 8
            }
        }()

        let raw = 50.0
            + min(max(momentumPct * 2.0, -25.0), 25.0)
            + (upShare - 0.5) * 30.0
            + (aboveAverage ? 5.0 : -5.0)
            - riskPenalty
        let score = Int(min(max(raw, 5.0), 95.0))

        let stance: GuardianScore.Stance = {
            if score >= 62 { return .buy }
            if score <= 38 { return .sell }
            return .hold
        }()

        // Confidence = signal agreement (momentum, breadth, vs-average all
        // pointing the same way) damped when the series is short.
        let direction = score >= 50 ? 1 : -1
        let agreements = [
            momentumPct > 0 ? 1 : -1,
            upShare > 0.5 ? 1 : -1,
            aboveAverage ? 1 : -1,
        ].filter { $0 == direction }.count
        let dataFactor = min(Double(closes.count) / 40.0, 1.0)
        let confidence: Int = {
            switch stance {
            case .hold: return 40 + Int(10 * dataFactor)
            default:    return min(max(40 + Int(Double(agreements) * 14 * dataFactor), 40), 92)
            }
        }()

        let volatilityLine: String = {
            let value = pct(volPct, signed: false)
            switch risk {
            case .low:    return "Volatility low (\(value)/bar)"
            case .medium: return "Volatility moderate (\(value)/bar)"
            case .high:   return "Volatility high (\(value)/bar)"
            }
        }()

        return GuardianScore(
            score: score,
            stance: stance,
            confidence: confidence,
            risk: risk,
            reasons: [
                "Momentum \(pct(momentumPct)) over \(timeframe)",
                "\(Int(upShare * 100))% of \(timeframe) bars closed up",
                volatilityLine,
                aboveAverage
                    ? "Trading above the \(timeframe) average"
                    : "Trading below the \(timeframe) average",
            ]
        )
    }

    /// Population standard deviation, matching the Kotlin (divides by n, not
    /// n-1). Changing the denominator here would move every score.
    private static func stdDev(_ values: [Double]) -> Double {
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
        return variance.squareRoot()
    }

    private static func pct(_ value: Double, signed: Bool = true) -> String {
        // U+2212 MINUS SIGN, as on Android — a hyphen renders too short next to
        // digits at complication sizes.
        let sign = !signed ? "" : (value >= 0 ? "+" : "\u{2212}")
        return sign + String(format: "%.1f", abs(value)) + "%"
    }
}
