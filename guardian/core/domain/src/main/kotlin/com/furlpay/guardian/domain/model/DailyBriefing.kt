package com.furlpay.guardian.domain.model

import kotlinx.datetime.LocalDate

/**
 * The morning briefing surface. The AI writes `summary`; the structured fields
 * are computed deterministically from the day's events so the UI never depends
 * on the model getting counts right.
 */
data class DailyBriefing(
    val date: LocalDate,
    val summary: String,
    val eventCount: Int,
    val criticalCount: Int,
    /** The single most urgent event to lead with, if any. */
    val topEvent: GuardianEvent?,
)
