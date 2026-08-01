package com.furlpay.guardian.mobile.taptopay

import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.os.Build
import android.provider.Settings
import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable

/**
 * Everything about THIS device that decides whether contactless acceptance can
 * work, answered without a network call.
 *
 * Split out from the service so it is testable: every input is injected, so a
 * unit test can describe a rooted Android 11 tablet with no NFC without owning
 * one.
 *
 * Deliberately NOT here: a hardcoded list of supported countries. Apple's and
 * the schemes' region lists move, and a stale copy would hide the feature from
 * a merchant who could use it. The PSP is asked instead.
 */
class TapToPayEnvironment(
    private val hasNfcHardware: Boolean,
    private val isNfcEnabled: Boolean,
    private val sdkInt: Int,
) {

    /**
     * The first blocker, or null if the device itself is fine.
     *
     * Ordered cheapest-and-most-permanent first, because the answer a merchant
     * needs is the one they can act on: there is no point asking a PSP about a
     * phone that has no NFC radio.
     */
    fun blocker(): TapToPayUnavailable? = when {
        !hasNfcHardware -> TapToPayUnavailable.NoNfc
        sdkInt < MIN_SDK -> TapToPayUnavailable.OsTooOld
        // Checked AFTER the OS, so an old phone is told it is old rather than
        // being sent to a settings screen that will not help.
        !isNfcEnabled -> TapToPayUnavailable.NfcDisabled
        else -> null
    }

    companion object {
        /**
         * Android 12. PSP SDKs require it; the app's own minSdk is 26, so this
         * is a real runtime state on a meaningful share of devices and not a
         * theoretical branch.
         *
         * Raising minSdk to 31 instead would drop every user on 26–30 to add
         * one optional feature, which is the wrong trade.
         */
        const val MIN_SDK = Build.VERSION_CODES.S

        fun from(context: Context): TapToPayEnvironment {
            val adapter = NfcAdapter.getDefaultAdapter(context)
            return TapToPayEnvironment(
                hasNfcHardware = adapter != null,
                isNfcEnabled = adapter?.isEnabled == true,
                sdkInt = Build.VERSION.SDK_INT,
            )
        }

        /**
         * Opens the NFC settings panel. The merchant cannot enable NFC from
         * inside a third-party app, so the honest thing is to take them
         * straight there rather than describe the menu path.
         */
        fun nfcSettingsIntent(): Intent =
            Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
