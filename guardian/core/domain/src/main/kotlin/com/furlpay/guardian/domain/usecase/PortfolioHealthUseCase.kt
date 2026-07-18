package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.Position
import java.util.Locale
import kotlin.math.abs

/**
 * Portfolio health — pure math over the positions the watch already has.
 * No new endpoints, no model calls: diversification is normalized inverse
 * Herfindahl, stablecoin share is a symbol allowlist, top/worst are the
 * day's extremes.
 */
data class PortfolioHealth(
    /** 0..100 — 0 = everything in one asset, 100 = perfectly spread. */
    val diversificationPct: Int,
    /** 0..100 — share of USD value parked in stablecoins. */
    val stablecoinPct: Int,
    val top: Position?,
    val worst: Position?,
)

private val STABLE_SYMBOLS = setOf(
    "USDC", "USDT", "DAI", "XSGD", "PYUSD", "EURC", "USDS", "TUSD", "FDUSD", "GUSD",
)

fun Portfolio.health(): PortfolioHealth? {
    val held = positions.filter { it.usdValue > 0 }
    if (held.isEmpty()) return null
    val total = held.sumOf { it.usdValue }

    // Normalized inverse HHI: (1 - Σw²) / (1 - 1/n) so a perfectly even
    // n-asset portfolio scores 100 regardless of n.
    val hhi = held.sumOf { (it.usdValue / total).let { w -> w * w } }
    val diversification =
        if (held.size < 2) 0
        else (((1.0 - hhi) / (1.0 - 1.0 / held.size)) * 100).toInt().coerceIn(0, 100)

    val stablePct = (held.filter { it.symbol.uppercase() in STABLE_SYMBOLS }
        .sumOf { it.usdValue } / total * 100).toInt()

    return PortfolioHealth(
        diversificationPct = diversification,
        stablecoinPct = stablePct,
        top = held.maxByOrNull { it.dayChangePct },
        worst = held.minByOrNull { it.dayChangePct },
    )
}

/**
 * The home screen's one AI-brief line. Deterministic and honest — it names
 * the number it derives from. Null when there's nothing worth saying.
 */
fun Portfolio.briefLine(): String? {
    val mover = topMover ?: return when {
        dayChangePct >= 0.5 -> "Portfolio up ${fmtPct(dayChangePct)} today"
        dayChangePct <= -0.5 -> "Portfolio down ${fmtPct(dayChangePct)} today"
        else -> null
    }
    return when {
        abs(mover.dayChangePct) < 2.0 && abs(dayChangePct) < 0.5 ->
            "Markets quiet — portfolio steady"
        mover.dayChangePct >= 0 ->
            "${mover.symbol} leads ${fmtPct(mover.dayChangePct)} — portfolio ${fmtPct(dayChangePct)}"
        else ->
            "${mover.symbol} drags ${fmtPct(mover.dayChangePct)} — portfolio ${fmtPct(dayChangePct)}"
    }
}

private fun fmtPct(value: Double): String =
    (if (value >= 0) "+" else "−") + String.format(Locale.US, "%.1f", abs(value)) + "%"
