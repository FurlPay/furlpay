package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TransactionDirection
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.isoDayNumber

/**
 * "How much did I spend today?" — computed HERE from the ledger, not asked of
 * the model. The API has no summary endpoint (verified against apps/web);
 * clients pull `/api/transactions` and this pure function does the math, so
 * the voice answer and the tile always agree.
 *
 * Only outgoing, non-declined transactions count as spending.
 */
class ComputeSpendingSummaryUseCase {

    operator fun invoke(
        transactions: List<Transaction>,
        period: SpendingPeriod,
        now: Instant,
        timeZone: TimeZone = TimeZone.currentSystemDefault(),
    ): SpendingSummary {
        val today = now.toLocalDateTime(timeZone).date
        val windowStart: LocalDate = when (period) {
            SpendingPeriod.TODAY -> today
            // ISO week — Monday start.
            SpendingPeriod.THIS_WEEK -> today.minus(DatePeriod(days = today.dayOfWeek.isoDayNumber - 1))
            SpendingPeriod.THIS_MONTH -> LocalDate(today.year, today.month, 1)
        }
        val startInstant = windowStart.atStartOfDayIn(timeZone)

        val spent = transactions.filter {
            it.direction == TransactionDirection.OUT &&
                it.status != "declined" &&
                it.at >= startInstant &&
                it.at <= now
        }

        val byCategory = spent
            .filter { it.category != null }
            .groupBy { it.category!! }
            .mapValues { (_, txs) -> txs.sumOf { it.amountUsd } }

        return SpendingSummary(
            period = period,
            totalUsd = spent.sumOf { it.amountUsd },
            transactionCount = spent.size,
            budgetUsd = null, // budgets are a phone-side preference, joined later
            topCategory = byCategory.maxByOrNull { it.value }?.key,
        )
    }
}
