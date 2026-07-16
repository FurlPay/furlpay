package com.furlpay.guardian.domain.model

/**
 * Spending window the `getSpending` voice tool accepts. [wireName] is the
 * exact string the API + tool schema use — keep them in lockstep.
 */
enum class SpendingPeriod(val wireName: String) {
    TODAY("today"),
    THIS_WEEK("this_week"),
    THIS_MONTH("this_month");

    companion object {
        fun fromWire(name: String): SpendingPeriod? =
            entries.firstOrNull { it.wireName == name }
    }
}

/**
 * What "how much did I spend?" answers with. Counts and totals are computed
 * server-side from the ledger; the watch only formats them.
 */
data class SpendingSummary(
    val period: SpendingPeriod,
    val totalUsd: Double,
    val transactionCount: Int,
    /** Budget for the period if the user set one; null = no budget. */
    val budgetUsd: Double? = null,
    val topCategory: String? = null,
) {
    /** 0..1+ fraction of budget consumed; null when no budget is set. */
    val budgetUsedFraction: Double?
        get() = budgetUsd?.takeIf { it > 0 }?.let { totalUsd / it }
}
