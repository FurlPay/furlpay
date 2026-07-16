package com.furlpay.guardian.wear.complication

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.furlpay.guardian.sync.PortfolioSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.ui.compactUsd
import com.furlpay.guardian.wear.wearServices

/** Watch-face slot: "+$42 ▲" — portfolio day change. Cache only. */
class PortfolioChangeComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_PORTFOLIO)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(PortfolioSnapshot.serializer(), stored.json)
                }.getOrNull()
            }
        val text = snapshot?.let {
            val sign = if (it.dayChangeUsd >= 0) "+" else "−"
            val arrow = if (it.dayChangeUsd >= 0) "▲" else "▼"
            sign + compactUsd(kotlin.math.abs(it.dayChangeUsd)) + arrow
        } ?: "—"
        return shortText(text)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) shortText("+$42▲") else null

    private fun shortText(text: String): ComplicationData =
        ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            contentDescription = PlainComplicationText.Builder("Portfolio day change").build(),
        ).build()
}
