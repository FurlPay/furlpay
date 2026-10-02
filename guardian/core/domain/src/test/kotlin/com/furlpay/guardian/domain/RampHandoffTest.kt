package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.ramp.RampHandoff
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RampHandoffTest {

    @Test
    fun presetsOpenTheBuyScreenWithTheAmount() {
        for (amount in RampHandoff.PRESETS_USD) {
            assertEquals("furlpay://ramp?mode=buy&amount=$amount", RampHandoff.deepLink(amount))
        }
    }

    @Test
    fun outOfRangeAmountsProduceNoLink() {
        assertNull(RampHandoff.deepLink(0))
        assertNull(RampHandoff.deepLink(-5))
        assertNull(RampHandoff.deepLink(50_001))
    }

    @Test
    fun copyNamesTheRealProviderAndPromisesNothing() {
        assertTrue(RampHandoff.HANDED_OFF.contains("Coinbase"))
        for (text in listOf(RampHandoff.HANDED_OFF, RampHandoff.NO_PHONE)) {
            assertFalse(Regex("instant|guaranteed|0% fee|FurlGateway", RegexOption.IGNORE_CASE).containsMatchIn(text))
        }
    }
}
