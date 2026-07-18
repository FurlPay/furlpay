package com.furlpay.guardian.domain.usecase

import java.util.Locale
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Guardian Score — the watch's honest "AI take" on an asset, computed from the
 * bars the stock screen already fetched. Deterministic signal math, NOT an LLM
 * hallucination: momentum, breadth (share of up bars), volatility, and
 * position vs the period average. Gemini remains the conversational layer;
 * this is the glanceable one.
 */
data class GuardianScore(
    /** 5..95 — never pretends certainty at the extremes. */
    val score: Int,
    val stance: Stance,
    /** 0..100 — how strongly the signals agree, damped on thin data. */
    val confidence: Int,
    val risk: Risk,
    /** Human "why" lines, strongest first — the tap-to-expand reasoning. */
    val reasons: List<String>,
) {
    enum class Stance { BUY, HOLD, SELL }
    enum class Risk { LOW, MEDIUM, HIGH }
}

object ComputeGuardianScoreUseCase {

    private const val MIN_BARS = 8

    /**
     * [closes] oldest→newest for the visible timeframe; [timeframe] is the
     * chip label ("1M") used in the reasoning copy. Null when there isn't
     * enough history to say anything defensible.
     */
    operator fun invoke(closes: List<Double>, timeframe: String): GuardianScore? {
        if (closes.size < MIN_BARS || closes.any { it <= 0.0 }) return null

        val returns = closes.zipWithNext { a, b -> b / a - 1.0 }
        val momentumPct = (closes.last() / closes.first() - 1.0) * 100.0
        val upShare = returns.count { it > 0 }.toDouble() / returns.size
        val volPct = stdDev(returns) * 100.0
        val average = closes.average()
        val aboveAverage = closes.last() > average

        val risk = when {
            volPct < 1.2 -> GuardianScore.Risk.LOW
            volPct < 2.8 -> GuardianScore.Risk.MEDIUM
            else -> GuardianScore.Risk.HIGH
        }

        val score = (
            50.0 +
                (momentumPct * 2.0).coerceIn(-25.0, 25.0) +
                (upShare - 0.5) * 30.0 +
                (if (aboveAverage) 5.0 else -5.0) -
                when (risk) {
                    GuardianScore.Risk.LOW -> 0.0
                    GuardianScore.Risk.MEDIUM -> 4.0
                    GuardianScore.Risk.HIGH -> 8.0
                }
            ).coerceIn(5.0, 95.0).toInt()

        val stance = when {
            score >= 62 -> GuardianScore.Stance.BUY
            score <= 38 -> GuardianScore.Stance.SELL
            else -> GuardianScore.Stance.HOLD
        }

        // Confidence = signal agreement (momentum, breadth, vs-average all
        // pointing the same way) damped when the series is short.
        val direction = if (score >= 50) 1 else -1
        val agreements = listOf(
            if (momentumPct > 0) 1 else -1,
            if (upShare > 0.5) 1 else -1,
            if (aboveAverage) 1 else -1,
        ).count { it == direction }
        val dataFactor = (closes.size / 40.0).coerceAtMost(1.0)
        val confidence = when (stance) {
            GuardianScore.Stance.HOLD -> 40 + (10 * dataFactor).toInt()
            else -> (40 + agreements * 14 * dataFactor).toInt().coerceIn(40, 92)
        }

        val reasons = buildList {
            add("Momentum ${pct(momentumPct)} over $timeframe")
            add("${(upShare * 100).toInt()}% of $timeframe bars closed up")
            add(
                when (risk) {
                    GuardianScore.Risk.LOW -> "Volatility low (${pct(volPct, signed = false)}/bar)"
                    GuardianScore.Risk.MEDIUM -> "Volatility moderate (${pct(volPct, signed = false)}/bar)"
                    GuardianScore.Risk.HIGH -> "Volatility high (${pct(volPct, signed = false)}/bar)"
                },
            )
            add(if (aboveAverage) "Trading above the $timeframe average" else "Trading below the $timeframe average")
        }

        return GuardianScore(score, stance, confidence, risk, reasons)
    }

    private fun stdDev(values: List<Double>): Double {
        val mean = values.average()
        return sqrt(values.sumOf { (it - mean) * (it - mean) } / values.size)
    }

    private fun pct(value: Double, signed: Boolean = true): String {
        val sign = if (!signed) "" else if (value >= 0) "+" else "−"
        return sign + String.format(Locale.US, "%.1f", abs(value)) + "%"
    }
}
