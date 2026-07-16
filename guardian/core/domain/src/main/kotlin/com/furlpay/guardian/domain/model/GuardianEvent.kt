package com.furlpay.guardian.domain.model

import kotlinx.datetime.Instant

/** Where an event came from. Drives the icon + how much we trust its parse. */
enum class EventSource { GMAIL, CALENDAR, GITHUB, TELEGRAM, MANUAL }

/**
 * Escalation urgency. Ordinal is significant — higher = more urgent — so
 * comparisons and sorting use it directly. Keep declaration order.
 */
enum class EventPriority { LOW, MEDIUM, HIGH, CRITICAL }

/**
 * A single thing the user needs to know about or act on, normalized from any
 * source (email, calendar, GitHub, Telegram, or manual entry).
 *
 * `startAt` is when the event happens (a meeting) or is due (a deadline);
 * null for something with no time (an unread PR review with no SLA).
 */
data class GuardianEvent(
    val id: String,
    val source: EventSource,
    val title: String,
    val detail: String? = null,
    val startAt: Instant? = null,
    val priority: EventPriority = EventPriority.MEDIUM,
    /** Deep link opened when the user taps the event (Meet URL, PR URL, …). */
    val actionUrl: String? = null,
    /** True once the user has explicitly acknowledged/dismissed it. */
    val acknowledged: Boolean = false,
)
