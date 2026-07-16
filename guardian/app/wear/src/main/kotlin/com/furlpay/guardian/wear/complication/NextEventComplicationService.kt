package com.furlpay.guardian.wear.complication

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.wear.wearServices
import kotlinx.datetime.Clock

/**
 * Watch-face slot: "Standup 45m" — next Guardian event + countdown. Reads the
 * local Room feed (already on-device — the one repo a complication may hit).
 */
class NextEventComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        val now = Clock.System.now()
        val next = (applicationContext.wearServices.eventRepo.activeEvents() as? GuardianResult.Ok)
            ?.value
            ?.filter { it.startAt != null && it.startAt!! >= now }
            ?.minByOrNull { it.startAt!! }
            ?: return shortText("—", "No upcoming events")

        val minutes = (next.startAt!! - now).inWholeMinutes.coerceAtLeast(0)
        val countdown = when {
            minutes < 60 -> "${minutes}m"
            minutes < 24 * 60 -> "${minutes / 60}h"
            else -> "${minutes / (24 * 60)}d"
        }
        // SHORT_TEXT budget is ~7 chars ideal: clipped title + countdown.
        val title = next.title.take(6)
        return shortText("$title $countdown", next.title)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        if (type == ComplicationType.SHORT_TEXT) shortText("Mtg 2h", "Next event") else null

    private fun shortText(text: String, description: String): ComplicationData =
        ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            contentDescription = PlainComplicationText.Builder(description).build(),
        ).build()
}
