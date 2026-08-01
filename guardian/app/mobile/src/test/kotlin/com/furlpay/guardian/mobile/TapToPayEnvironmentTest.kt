package com.furlpay.guardian.mobile

import com.furlpay.guardian.domain.taptopay.TapToPayFailure
import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable
import com.furlpay.guardian.mobile.taptopay.IntegrityOutcome
import com.furlpay.guardian.mobile.taptopay.TapToPayEnvironment
import com.furlpay.guardian.mobile.taptopay.asUnavailable
import com.furlpay.guardian.mobile.viewmodel.TapToPayViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Device gating, attestation mapping and merchant copy — all pure, so a unit
 * test can describe a rooted Android 11 phone with no NFC without owning one.
 */
class TapToPayEnvironmentTest {

    private fun env(nfc: Boolean = true, enabled: Boolean = true, sdk: Int = 33) =
        TapToPayEnvironment(hasNfcHardware = nfc, isNfcEnabled = enabled, sdkInt = sdk)

    @Test
    fun `a capable phone has no blocker`() {
        assertNull(env().blocker())
    }

    @Test
    fun `no NFC hardware blocks first`() {
        // Checked before everything else because it is free and permanent.
        assertEquals(TapToPayUnavailable.NoNfc, env(nfc = false, enabled = false, sdk = 26).blocker())
    }

    @Test
    fun `an old OS is reported as old, not as a settings problem`() {
        // Order matters: sending someone on Android 11 to the NFC settings
        // panel would waste their time on a fix that cannot work.
        assertEquals(
            TapToPayUnavailable.OsTooOld,
            env(nfc = true, enabled = false, sdk = 30).blocker(),
        )
    }

    @Test
    fun `NFC switched off is reported once the OS is new enough`() {
        assertEquals(
            TapToPayUnavailable.NfcDisabled,
            env(nfc = true, enabled = false, sdk = 33).blocker(),
        )
    }

    @Test
    fun `Android 12 is the floor`() {
        assertEquals(TapToPayUnavailable.OsTooOld, env(sdk = 30).blocker())
        assertNull(env(sdk = TapToPayEnvironment.MIN_SDK).blocker())
    }
}

class DeviceIntegrityTest {

    @Test
    fun `a token clears the gate`() {
        assertNull(IntegrityOutcome.Token("abc").asUnavailable())
    }

    @Test
    fun `a failed attestation blocks`() {
        assertEquals(
            TapToPayUnavailable.IntegrityFailed("rooted"),
            IntegrityOutcome.Failed("rooted").asUnavailable(),
        )
    }

    @Test
    fun `an unconfigured attestation provider is a REFUSAL, not a pass`() {
        // On a platform where any APK can ask for NFC, "we could not check" and
        // "the device is fine" are not the same answer.
        assertEquals(
            TapToPayUnavailable.NoProvider,
            IntegrityOutcome.NotConfigured.asUnavailable(),
        )
    }
}

class TapToPayCopyTest {

    @Test
    fun `a decline does not blame the app`() {
        // The merchant is standing in front of the customer. "Something went
        // wrong" invites them to retry a card the issuer already refused.
        val copy = TapToPayViewModel.messageFor(TapToPayFailure.Declined(null)).lowercase()
        assertTrue(copy.contains("declined"))
        assertFalse(copy.contains("error"))
        assertFalse(copy.contains("wrong"))
    }

    @Test
    fun `a network failure states the payment was NOT taken`() {
        // Ambiguity here is what causes double-charging: a merchant who is not
        // sure whether it went through will run the card again.
        val copy = TapToPayViewModel.messageFor(TapToPayFailure.Network("timeout")).lowercase()
        assertTrue(copy.contains("wasn't taken"))
    }

    @Test
    fun `a card read failure tells the merchant what to do about it`() {
        val copy = TapToPayViewModel.messageFor(TapToPayFailure.CardReadFailed(null)).lowercase()
        assertTrue(copy.contains("closer") || copy.contains("hold"))
    }

    @Test
    fun `integrity copy does not name the signal that failed`() {
        // Naming the check tells someone trying to defeat it exactly what to
        // change. The copy explains the policy, not the detection.
        val copy = TapToPayViewModel.detailFor(TapToPayUnavailable.IntegrityFailed("root detected"))
            .lowercase()
        assertFalse(copy.contains("root"))
        assertFalse(copy.contains("emulator"))
        assertFalse(copy.contains("bootloader"))
        assertTrue(copy.contains("google play"))
    }

    @Test
    fun `every reason has a title and a detail`() {
        val reasons = listOf(
            TapToPayUnavailable.NoNfc,
            TapToPayUnavailable.NfcDisabled,
            TapToPayUnavailable.OsTooOld,
            TapToPayUnavailable.IntegrityFailed(null),
            TapToPayUnavailable.RegionNotSupported("Brazil"),
            TapToPayUnavailable.RegionNotSupported(null),
            TapToPayUnavailable.NoProvider,
            TapToPayUnavailable.TermsNotAccepted,
            TapToPayUnavailable.MerchantNotOnboarded(null),
        )
        reasons.forEach {
            assertTrue(TapToPayViewModel.titleFor(it).isNotBlank(), "title for $it")
            assertTrue(TapToPayViewModel.detailFor(it).isNotBlank(), "detail for $it")
        }
    }

    @Test
    fun `a named region appears in the copy`() {
        assertTrue(
            TapToPayViewModel.detailFor(TapToPayUnavailable.RegionNotSupported("Brazil"))
                .contains("Brazil"),
        )
    }
}
