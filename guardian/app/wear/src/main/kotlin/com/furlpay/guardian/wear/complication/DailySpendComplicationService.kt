package com.furlpay.guardian.wear.complication

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.furlpay.guardian.sync.SpendingSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.ui.compactUsd
import com.furlpay.guardian.wear.wearServices

/** Watch-face slot: "↓$87" — what left the account today. Cache only. */
class DailySpendComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_SPENDING)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(SpendingSnapshot.serializer(), stored.json)
                }.getOrNull()
            }
        return shortText(snapshot?.let { "↓" + compactUsd(it.todayUsd) } ?: "—")
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) shortText("↓$87") else null

    private fun shortText(text: String): ComplicationData =
        ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            contentDescription = PlainComplicationText.Builder("Spent today").build(),
        ).build()
}
