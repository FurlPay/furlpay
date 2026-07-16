package com.furlpay.guardian.domain.model

/** One holding inside the portfolio. */
data class Position(
    val symbol: String,
    val quantity: Double,
    val usdValue: Double,
    /** Day change in percent, e.g. +5.8 for +5.8%. */
    val dayChangePct: Double,
)

/** `GET /api/investing/portfolio`, shaped for the watch tile + voice answer. */
data class Portfolio(
    val totalUsd: Double,
    val dayChangeUsd: Double,
    val dayChangePct: Double,
    val positions: List<Position>,
) {
    /** Biggest absolute mover of the day — the tile's one-liner. */
    val topMover: Position?
        get() = positions.maxByOrNull { kotlin.math.abs(it.dayChangePct) }
}
