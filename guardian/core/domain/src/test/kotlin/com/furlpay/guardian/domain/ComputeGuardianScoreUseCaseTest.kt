package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.usecase.ComputeGuardianScoreUseCase
import com.furlpay.guardian.domain.usecase.GuardianScore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ComputeGuardianScoreUseCaseTest {

    @Test
    fun `steady uptrend scores BUY with reasons`() {
        val closes = (0 until 40).map { 100.0 + it * 0.8 } // +31% straight up
        val score = ComputeGuardianScoreUseCase(closes, "1M")!!

        assertEquals(GuardianScore.Stance.BUY, score.stance)
        assertTrue(score.score >= 62, "score=${score.score}")
        assertTrue(score.confidence > 60, "confidence=${score.confidence}")
        assertEquals(GuardianScore.Risk.LOW, score.risk)
        assertTrue(score.reasons.any { it.startsWith("Momentum +") })
        assertTrue(score.reasons.any { it.contains("closed up") })
    }

    @Test
    fun `steady downtrend scores SELL`() {
        val closes = (0 until 40).map { 100.0 - it * 0.9 }
        val score = ComputeGuardianScoreUseCase(closes, "1M")!!

        assertEquals(GuardianScore.Stance.SELL, score.stance)
        assertTrue(score.score <= 38, "score=${score.score}")
    }

    @Test
    fun `flat choppy series scores HOLD`() {
        val closes = (0 until 40).map { 100.0 + if (it % 2 == 0) 0.4 else -0.4 }
        val score = ComputeGuardianScoreUseCase(closes, "1W")!!

        assertEquals(GuardianScore.Stance.HOLD, score.stance)
    }

    @Test
    fun `wild swings are flagged high risk`() {
        // Alternating ±8% bars — violent chop.
        var price = 100.0
        val closes = (0 until 40).map { i ->
            price *= if (i % 2 == 0) 1.08 else 0.92
            price
        }
        val score = ComputeGuardianScoreUseCase(closes, "1M")!!

        assertEquals(GuardianScore.Risk.HIGH, score.risk)
    }

    @Test
    fun `too little data refuses to score`() {
        assertNull(ComputeGuardianScoreUseCase(listOf(1.0, 2.0, 3.0), "1D"))
        assertNull(ComputeGuardianScoreUseCase(emptyList(), "1D"))
    }

    @Test
    fun `score never leaves the honest 5-95 band`() {
        val moon = (0 until 40).map { 100.0 * (1.15 * (it + 1)) }
        val crash = (0 until 40).map { 1000.0 / (it + 1) }
        assertTrue(ComputeGuardianScoreUseCase(moon, "1Y")!!.score <= 95)
        assertTrue(ComputeGuardianScoreUseCase(crash, "1Y")!!.score >= 5)
    }
}
