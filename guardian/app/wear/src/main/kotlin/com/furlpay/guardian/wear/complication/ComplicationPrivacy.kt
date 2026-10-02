package com.furlpay.guardian.wear.complication

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.getSystemService
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.furlpay.guardian.wear.tile.PortfolioTileService
import com.furlpay.guardian.wear.tile.WalletTileService

/**
 * Whether a money complication may print a real figure right now.
 *
 * The four complication providers read the synced snapshot and rendered net
 * worth, day change and today's spend straight onto the watch face with no
 * check of any kind. A watch face is the one surface in this product that
 * renders with no one holding the device: sitting on a charger, on a desk, or
 * on someone else's wrist after it was handed over. Anyone glancing at it read
 * the balance.
 *
 * The gate is the device lock. On Wear OS, taking the watch off locks it when a
 * screen lock is configured, so `isDeviceLocked` covers both "off-wrist" and
 * "locked in front of someone else" without the complication having to wait on
 * an off-body sensor — and a complication render must never wait on anything.
 *
 * A watch with NO screen lock configured is never "locked", so nothing is
 * redacted there. That is the honest outcome rather than a bug: the user has
 * declined device-level protection, and a complication cannot reinstate it.
 */
internal object ComplicationPrivacy {

    /** Stand-in for a redacted figure. Same width whatever the real number is. */
    const val REDACTED = "••••"

    /**
     * True when the value must be replaced with [REDACTED].
     *
     * Fails CLOSED: if the keyguard service cannot be reached we redact, since
     * the alternative is printing a balance because a system lookup failed.
     */
    fun isRedacted(context: Context): Boolean {
        val keyguard = context.getSystemService<KeyguardManager>() ?: return true
        return keyguard.isDeviceLocked
    }

    /**
     * Re-renders the money complications after an unlock.
     *
     * Without this the redaction would be sticky: the watch face system caches
     * whatever a provider last returned and only asks again on its own
     * schedule, so a user who unlocked their watch would keep seeing dots for
     * minutes and reasonably conclude the app was broken.
     */
    fun requestRefresh(context: Context) {
        for (service in REDACTING_SERVICES) {
            ComplicationDataSourceUpdateRequester
                .create(context.applicationContext, ComponentName(context.applicationContext, service))
                .requestUpdateAll()
        }
        // The money tiles use the same gate; re-render them too.
        val tiles = TileService.getUpdater(context.applicationContext)
        tiles.requestUpdate(WalletTileService::class.java)
        tiles.requestUpdate(PortfolioTileService::class.java)
    }

    private val REDACTING_SERVICES = listOf(
        BalanceComplicationService::class.java,
        DailySpendComplicationService::class.java,
        PortfolioChangeComplicationService::class.java,
    )
}

/**
 * Asks the money complications to re-render when the device is unlocked or the
 * screen comes on.
 *
 * Registered in code rather than the manifest: `ACTION_USER_PRESENT` and
 * `ACTION_SCREEN_ON` are not deliverable to manifest-declared receivers, so a
 * manifest entry would look correct and never fire.
 */
class ComplicationLockReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_USER_PRESENT, Intent.ACTION_SCREEN_ON ->
                ComplicationPrivacy.requestRefresh(context)
        }
    }

    companion object {
        val filter: IntentFilter
            get() = IntentFilter().apply {
                addAction(Intent.ACTION_USER_PRESENT)
                addAction(Intent.ACTION_SCREEN_ON)
            }
    }
}
