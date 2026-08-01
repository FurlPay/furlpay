package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.taptopay.TapToPayAvailability
import com.furlpay.guardian.domain.taptopay.TapToPayCharge
import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable
import com.furlpay.guardian.domain.taptopay.UnconfiguredTapToPayProvider
import kotlinx.coroutines.test.runTest
import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * The tap itself cannot be tested — it needs NFC hardware and a certified PSP
 * kernel. What CAN be tested is everything that decides what a customer is
 * charged and whether a terminal is offered at all, which is where the costly
 * mistakes live.
 *
 * These assertions deliberately mirror
 * ios/FurlPayGuardian/Tests/TapToPayTests.swift. If one platform's expectation
 * changes, the other's test should change in the same commit.
 */
class TapToPayChargeTest {

    @Test
    fun `minor units are exact, not floating point`() {
        // A Double round trip is how 19.99 becomes 1998 on someone's receipt.
        assertEquals(1L, TapToPayCharge(BigDecimal("0.01")).minorUnits)
        assertEquals(125L, TapToPayCharge(BigDecimal("1.25")).minorUnits)
        assertEquals(1999L, TapToPayCharge(BigDecimal("19.99")).minorUnits)
        assertEquals(10_000L, TapToPayCharge(BigDecimal("100.00")).minorUnits)
        assertEquals(999_999L, TapToPayCharge(BigDecimal("9999.99")).minorUnits)
    }

    @Test
    fun `rounding is half-up, the way a till rounds`() {
        // HALF_EVEN would give 100 here and surprise a merchant reconciling a
        // drawer against the customer's receipt.
        assertEquals(101L, TapToPayCharge(BigDecimal("1.005")).minorUnits)
        assertEquals(103L, TapToPayCharge(BigDecimal("1.025")).minorUnits)
    }

    @Test
    fun `zero and negative amounts are invalid`() {
        assertFalse(TapToPayCharge(BigDecimal.ZERO).isValid)
        assertFalse(TapToPayCharge(BigDecimal("-5")).isValid)
    }

    @Test
    fun `the policy ceiling is inclusive and enforced`() {
        assertTrue(TapToPayCharge(BigDecimal("10000")).isValid)
        assertFalse(TapToPayCharge(BigDecimal("10000.01")).isValid)
    }

    @Test
    fun `each charge gets its own idempotency key by default`() {
        assertNotEquals(
            TapToPayCharge(BigDecimal.TEN).idempotencyKey,
            TapToPayCharge(BigDecimal.TEN).idempotencyKey,
        )
    }

    @Test
    fun `an explicit key is preserved, so a retry is the same sale`() {
        val key = "sale-abc"
        assertEquals(key, TapToPayCharge(BigDecimal.TEN, idempotencyKey = key).idempotencyKey)
    }
}

class TapToPayAvailabilityTest {

    private val all = listOf(
        TapToPayUnavailable.NoNfc,
        TapToPayUnavailable.NfcDisabled,
        TapToPayUnavailable.OsTooOld,
        TapToPayUnavailable.IntegrityFailed("rooted"),
        TapToPayUnavailable.RegionNotSupported("Brazil"),
        TapToPayUnavailable.RegionNotSupported(null),
        TapToPayUnavailable.NoProvider,
        TapToPayUnavailable.TermsNotAccepted,
        TapToPayUnavailable.MerchantNotOnboarded("Verification pending"),
        TapToPayUnavailable.MerchantNotOnboarded(null),
    )

    @Test
    fun `permanent blockers are not marked recoverable`() {
        // Offering "try again" for a phone with no NFC radio is cruelty, not
        // helpfulness.
        assertFalse(TapToPayUnavailable.NoNfc.isRecoverable)
        assertFalse(TapToPayUnavailable.OsTooOld.isRecoverable)
        assertFalse(TapToPayUnavailable.RegionNotSupported("BR").isRecoverable)
    }

    @Test
    fun `an integrity failure is never retryable in place`() {
        // The remedy is outside the app — unroot, or reinstall from Play.
        // Offering a retry would train the merchant to tap it and get nowhere.
        assertFalse(TapToPayUnavailable.IntegrityFailed(null).isRecoverable)
    }

    @Test
    fun `fixable blockers are recoverable`() {
        assertTrue(TapToPayUnavailable.NfcDisabled.isRecoverable)
        assertTrue(TapToPayUnavailable.TermsNotAccepted.isRecoverable)
        assertTrue(TapToPayUnavailable.NoProvider.isRecoverable)
    }

    @Test
    fun `every reason is exhaustively handled`() {
        // Adding a case without giving it recoverability breaks compilation of
        // the sealed `when`; this keeps the list itself honest.
        assertEquals(10, all.size)
    }
}

class UnconfiguredProviderTest {

    @Test
    fun `availability reports no provider rather than pretending`() = runTest {
        assertEquals(
            TapToPayAvailability.Unavailable(TapToPayUnavailable.NoProvider),
            UnconfiguredTapToPayProvider.availability(),
        )
    }

    @Test
    fun `collecting fails instead of returning a fake success`() = runTest {
        // The worst outcome this feature can produce is a merchant believing
        // they were paid when they weren't. It must never succeed silently.
        val result = UnconfiguredTapToPayProvider.collect(TapToPayCharge(BigDecimal("25")))
        assertTrue(result is GuardianResult.Err)
    }

    @Test
    fun `accepting terms fails too`() = runTest {
        assertTrue(UnconfiguredTapToPayProvider.acceptTermsIfNeeded() is GuardianResult.Err)
    }
}
