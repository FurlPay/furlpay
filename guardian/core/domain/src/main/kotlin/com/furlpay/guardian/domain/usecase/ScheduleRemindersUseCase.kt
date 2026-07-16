package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.model.AlarmIntensity
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.model.ReminderStage
import kotlinx.datetime.Instant
import kotlin.time.Duration.Companion.minutes

/** A concrete alarm to arm: an absolute time + how hard to alert. */
data class ScheduledReminder(
    val eventId: String,
    val fireAt: Instant,
    val intensity: AlarmIntensity,
    val bypassDnd: Boolean,
)

/**
 * Turns an event's priority into a concrete escalation schedule.
 *
 * The higher the priority the earlier and louder the ramp:
 *   - CRITICAL: 4 stages (60m gentle → 15m firm → 5m urgent → at-time MAX,
 *     all DND-bypassing) — the "Life Guardian never lets you miss it" ladder.
 *   - HIGH: 2 stages (30m firm → 5m urgent).
 *   - MEDIUM: 1 stage (10m gentle).
 *   - LOW: none (it lives in the feed, it doesn't alarm).
 *
 * Stages whose fire time is already in the past (event is imminent) are
 * dropped, EXCEPT the at-time stage, so arming a late CRITICAL still alerts.
 * Pure — no scheduler here; the Android layer arms what this returns.
 */
class ScheduleRemindersUseCase {

    operator fun invoke(event: GuardianEvent, now: Instant): List<ScheduledReminder> {
        val start = event.startAt ?: return emptyList()
        val stages = laddersFor(event.priority)
        return stages
            .map { stage ->
                ScheduledReminder(
                    eventId = event.id,
                    fireAt = start + stage.offset,
                    intensity = stage.intensity,
                    bypassDnd = stage.bypassDnd,
                )
            }
            .filter { it.fireAt >= now || it.intensity == AlarmIntensity.MAX }
            .sortedBy { it.fireAt }
    }

    private fun laddersFor(priority: EventPriority): List<ReminderStage> = when (priority) {
        EventPriority.CRITICAL -> listOf(
            ReminderStage((-60).minutes, AlarmIntensity.GENTLE, bypassDnd = true),
            ReminderStage((-15).minutes, AlarmIntensity.FIRM, bypassDnd = true),
            ReminderStage((-5).minutes, AlarmIntensity.URGENT, bypassDnd = true),
            ReminderStage(0.minutes, AlarmIntensity.MAX, bypassDnd = true),
        )
        EventPriority.HIGH -> listOf(
            ReminderStage((-30).minutes, AlarmIntensity.FIRM, bypassDnd = false),
            ReminderStage((-5).minutes, AlarmIntensity.URGENT, bypassDnd = false),
        )
        EventPriority.MEDIUM -> listOf(
            ReminderStage((-10).minutes, AlarmIntensity.GENTLE, bypassDnd = false),
        )
        EventPriority.LOW -> emptyList()
    }
}
