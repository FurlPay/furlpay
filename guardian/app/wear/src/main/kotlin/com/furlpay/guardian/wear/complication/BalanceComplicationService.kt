package com.furlpay.guardian.wear.complication

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.WalletSnapshot
import com.furlpay.guardian.wear.ui.compactUsd
import com.furlpay.guardian.wear.wearServices

/**
 * Watch-face slot: total balance, compact ("$1.2k"). Snapshot cache only —
 * a complication render must never wait on the network.
 *
 * Redacted while the device is locked. This printed the user's whole net worth
 * on the watch face unconditionally, which is readable by anyone near a watch
 * on a charger or a desk. See [ComplicationPrivacy].
 */
class BalanceComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        // Checked before the snapshot is even read: a locked watch has no
        // reason to touch the stored figure at all.
        if (ComplicationPrivacy.isRedacted(applicationContext)) {
            return shortText(ComplicationPrivacy.REDACTED, description = "Balance hidden while locked")
        }
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_WALLET)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(WalletSnapshot.serializer(), stored.json)
                }.getOrNull()
            }
        return shortText(snapshot?.let { compactUsd(it.totalUsd) } ?: "—")
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) shortText("$1.2k") else null

    private fun shortText(
        text: String,
        description: String = "FurlPay balance",
    ): ComplicationData =
        ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            // The description must be redacted too — a screen reader that spoke
            // the balance out loud would defeat the point of hiding it.
            contentDescription = PlainComplicationText.Builder(description).build(),
        ).build()
}
