package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.Position
import com.furlpay.guardian.domain.usecase.briefLine
import com.furlpay.guardian.domain.usecase.health
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PortfolioHealthUseCaseTest {

    private fun portfolio(vararg positions: Position, dayChangePct: Double = 0.0) = Portfolio(
        totalUsd = positions.sumOf { it.usdValue },
        dayChangeUsd = 0.0,
        dayChangePct = dayChangePct,
        positions = positions.toList(),
    )

    @Test
    fun `even split scores 100 diversification`() {
        val health = portfolio(
            Position("AAPL", 1.0, 1000.0, 1.0),
            Position("NVDA", 1.0, 1000.0, 2.0),
            Position("BTC", 1.0, 1000.0, -1.0),
            Position("ETH", 1.0, 1000.0, 0.5),
        ).health()!!

        assertEquals(100, health.diversificationPct)
    }

    @Test
    fun `single asset scores 0 diversification`() {
        val health = portfolio(Position("BTC", 1.0, 5000.0, 3.0)).health()!!
        assertEquals(0, health.diversificationPct)
    }

    @Test
    fun `stablecoin share and extremes`() {
        val health = portfolio(
            Position("USDC", 1.0, 4000.0, 0.0),
            Position("NVDA", 1.0, 4000.0, 5.5),
            Position("LCID", 1.0, 2000.0, -3.2),
        ).health()!!

        assertEquals(40, health.stablecoinPct)
        assertEquals("NVDA", health.top?.symbol)
        assertEquals("LCID", health.worst?.symbol)
    }

    @Test
    fun `empty portfolio has no health`() {
        assertNull(portfolio().health())
    }

    @Test
    fun `brief line names the biggest mover`() {
        val line = portfolio(
            Position("NVDA", 1.0, 4000.0, 5.5),
            Position("USDC", 1.0, 4000.0, 0.0),
            dayChangePct = 2.1,
        ).briefLine()!!

        assertTrue("NVDA" in line && "leads" in line, line)
    }

    @Test
    fun `quiet day says so instead of inventing news`() {
        val line = portfolio(
            Position("USDC", 1.0, 4000.0, 0.1),
            dayChangePct = 0.1,
        ).briefLine()

        assertEquals("Markets quiet — portfolio steady", line)
    }
}
