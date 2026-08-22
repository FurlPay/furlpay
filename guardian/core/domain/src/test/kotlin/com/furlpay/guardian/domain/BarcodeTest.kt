package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.trips.boardingPassBars
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Pins the bar pattern so the four implementations cannot drift apart.
 *
 * The expected values were produced from apps/web/src/lib/trips/barcode.ts —
 * the original — so this test failing means the Kotlin port diverged from the
 * pattern web, Expo and SwiftUI draw, not that the numbers are arbitrary.
 * The sibling tests live in the web barcode spec, the native-app one, and
 * ios/FurlPayGuardian/Tests/BoardingPassTests.swift.
 */
class BarcodeTest {

    @Test
    fun `bars match the TypeScript original for a known pass id`() {
        val bars = boardingPassBars("bp_demo_cdg_u_123")

        assertEquals(116, bars.size, "4 leading guard + 108 body + 4 trailing guard")
        assertEquals(
            listOf(3, 2, 1, 3, 4, 2, 3, 2, 3, 3, 1, 4, 2, 2, 2, 4),
            bars.take(16),
        )
        assertEquals(listOf(4, 4, 4, 3, 3, 2, 1, 4), bars.takeLast(8))
        assertEquals(284, bars.sum())
    }

    @Test
    fun `guard bars bracket every pattern`() {
        for (value in listOf("", "GE352", "bp_demo_cdg_arthur")) {
            val bars = boardingPassBars(value)
            assertEquals(listOf(3, 2, 1, 3), bars.take(4), "leading guard for [$value]")
            assertEquals(listOf(3, 2, 1, 4), bars.takeLast(4), "trailing guard for [$value]")
        }
    }

    @Test
    fun `the empty string still produces a full pattern`() {
        // The FNV basis alone seeds the LCG, so an id that has not loaded yet
        // draws bars rather than a blank strip that looks like a broken pass.
        assertEquals(listOf(3, 2, 1, 3, 3, 1, 3, 1, 1, 3, 4, 4), boardingPassBars("").take(12))
    }

    @Test
    fun `body bar widths stay inside the drawable range`() {
        val body = boardingPassBars("bp_demo_cdg_u_123").drop(4).dropLast(4)
        assertEquals(108, body.size)
        assertTrue(body.all { it in 1..4 }, "widths outside 1..4 would break the strip layout")
    }

    @Test
    fun `the same id always draws the same bars`() {
        assertEquals(boardingPassBars("GE352"), boardingPassBars("GE352"))
    }

    @Test
    fun `different ids draw different bars`() {
        assertNotEquals(boardingPassBars("bp_a"), boardingPassBars("bp_b"))
    }
}
