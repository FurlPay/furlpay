package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.CardDesign
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CardDesignTest {

    @Test
    fun recognisesTheThreeDesignsByTheServersGradient() {
        assertEquals(CardDesign.ELECTRIC, CardDesign.from(listOf("#14197D", "#006BFF")))
        assertEquals(CardDesign.WORLD, CardDesign.from(listOf("#060b21", "#0b2a6b")))
        assertEquals(CardDesign.PEARL, CardDesign.from(listOf("#F1F0FF", "#C7A7F8")))
    }

    @Test
    fun olderThemesAndMissingGradientsHaveNoDesign() {
        assertNull(CardDesign.from(null))
        assertNull(CardDesign.from(emptyList()))
        assertNull(CardDesign.from(listOf("#0B1220", "#1E293B")))
        assertNull(CardDesign.from(listOf("#14197D")))
        assertNull(Card(id = "c1", last4 = "4821", kind = "virtual", frozen = false).design)
    }

    @Test
    fun aCardExposesItsDesign() {
        val card = Card(
            id = "c1", last4 = "4821", kind = "virtual", frozen = false,
            gradient = listOf("#F1F0FF", "#C7A7F8"),
        )
        assertEquals(CardDesign.PEARL, card.design)
    }

    @Test
    fun everyDesignIsOpaqueAndHasAGradient() {
        for (d in CardDesign.entries) {
            assertTrue(d.colors.size >= 2)
            for (c in d.colors + d.ink + d.border) assertEquals(0xFFL, c ushr 24)
        }
    }
}
