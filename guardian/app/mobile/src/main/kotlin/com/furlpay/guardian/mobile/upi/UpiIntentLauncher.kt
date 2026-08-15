package com.furlpay.guardian.mobile.upi

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.furlpay.guardian.domain.upi.UpiPaymentRequest
import java.math.BigDecimal

/**
 * Hands a parsed UPI request to an installed PSP app (GPay / PhonePe / Paytm /
 * BHIM / any bank app).
 *
 * WHAT GUARDIAN DOES AND DOES NOT DO HERE. It parses the QR, shows the payee for
 * checking, and launches the intent. The payment itself happens entirely inside
 * the user's UPI app against their bank account — Guardian never holds the
 * money, never sees the PIN, and writes no ledger entry. That is why this flow
 * needs no gateway credentials and no PSP licence, unlike every other UPI
 * feature in the plan.
 *
 * PACKAGE VISIBILITY. Android 11+ hides other apps unless the manifest declares
 * a matching <queries> entry. Without the `upi` scheme query (see
 * AndroidManifest.xml) resolveActivity returns null even with GPay installed,
 * and this would report [Result.NoUpiApp] on every modern device. The manifest
 * entry and this file have to stay together.
 */
object UpiIntentLauncher {

    sealed interface Result {
        data object Launched : Result
        /** No installed app handles `upi://` — tell the user, never fail silently. */
        data object NoUpiApp : Result
        data class Invalid(val reason: String) : Result
    }

    /**
     * @param amountOverride the amount for a static QR that carried none.
     */
    fun launch(
        context: Context,
        request: UpiPaymentRequest,
        amountOverride: BigDecimal? = null,
    ): Result {
        val uri = try {
            request.toIntentUri(amountOverride)
        } catch (e: IllegalArgumentException) {
            return Result.Invalid(e.message ?: "Invalid payment details")
        }

        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        // resolveActivity is the check that <queries> enables. Asking first means
        // a device with no UPI app gets a clear message instead of an
        // ActivityNotFoundException surfacing as a crash.
        if (intent.resolveActivity(context.packageManager) == null) return Result.NoUpiApp

        // A chooser rather than a direct start: several PSP apps may handle the
        // intent, and picking one for the user would be both wrong and a
        // commercial statement. NEW_TASK because the caller may be a non-Activity
        // context.
        val chooser = Intent.createChooser(intent, "Pay with UPI")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(chooser)
            Result.Launched
        } catch (_: ActivityNotFoundException) {
            // Race: the handling app was uninstalled between resolve and start.
            Result.NoUpiApp
        }
    }
}
