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
 */
class BalanceComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
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

    private fun shortText(text: String): ComplicationData =
        ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            contentDescription = PlainComplicationText.Builder("FurlPay balance").build(),
        ).build()
}
