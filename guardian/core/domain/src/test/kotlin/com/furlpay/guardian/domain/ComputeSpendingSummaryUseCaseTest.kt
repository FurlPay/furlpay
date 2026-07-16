package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TransactionDirection
import com.furlpay.guardian.domain.usecase.ComputeSpendingSummaryUseCase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone

class ComputeSpendingSummaryUseCaseTest {

    private val compute = ComputeSpendingSummaryUseCase()
    private val tz = TimeZone.UTC

    // Wednesday 2026-07-15 12:00 UTC.
    private val now = Instant.parse("2026-07-15T12:00:00Z")

    private fun tx(
        id: String,
        at: String,
        amount: Double,
        direction: TransactionDirection = TransactionDirection.OUT,
        status: String = "settled",
        category: String? = null,
    ) = Transaction(id, Instant.parse(at), "tx-$id", amount, direction, status, category)

    @Test
    fun `today only counts outgoing settled transactions from midnight`() {
        val txs = listOf(
            tx("1", "2026-07-15T09:00:00Z", 50.0, category = "food"),
            tx("2", "2026-07-15T10:00:00Z", 37.30, category = "transport"),
            tx("3", "2026-07-14T23:59:00Z", 500.0), // yesterday — out of window
            tx("4", "2026-07-15T11:00:00Z", 25.0, direction = TransactionDirection.IN), // income
            tx("5", "2026-07-15T11:30:00Z", 999.0, status = "declined"), // never spent
        )
        val summary = compute(txs, SpendingPeriod.TODAY, now, tz)
        assertEquals(87.30, summary.totalUsd, absoluteTolerance = 1e-9)
        assertEquals(2, summary.transactionCount)
        assertEquals("food", summary.topCategory)
    }

    @Test
    fun `this_week starts Monday`() {
        val txs = listOf(
            tx("1", "2026-07-13T08:00:00Z", 10.0), // Monday — in
            tx("2", "2026-07-12T08:00:00Z", 99.0), // Sunday — previous week
        )
        val summary = compute(txs, SpendingPeriod.THIS_WEEK, now, tz)
        assertEquals(10.0, summary.totalUsd)
        assertEquals(1, summary.transactionCount)
    }

    @Test
    fun `this_month starts on the 1st`() {
        val txs = listOf(
            tx("1", "2026-07-01T00:00:00Z", 5.0),
            tx("2", "2026-06-30T23:59:59Z", 7.0), // June — out
        )
        val summary = compute(txs, SpendingPeriod.THIS_MONTH, now, tz)
        assertEquals(5.0, summary.totalUsd)
    }

    @Test
    fun `top category is the largest by amount, not count`() {
        val txs = listOf(
            tx("1", "2026-07-15T09:00:00Z", 5.0, category = "coffee"),
            tx("2", "2026-07-15T09:10:00Z", 5.0, category = "coffee"),
            tx("3", "2026-07-15T09:20:00Z", 100.0, category = "electronics"),
        )
        assertEquals("electronics", compute(txs, SpendingPeriod.TODAY, now, tz).topCategory)
    }
}
