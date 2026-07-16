package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.AlarmIntensity
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.usecase.ScheduleRemindersUseCase
import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

private val NOW = Instant.parse("2026-07-16T09:00:00Z")

private fun ev(priority: EventPriority, startAt: Instant?) =
    GuardianEvent(id = "e", source = EventSource.CALENDAR, title = "e", priority = priority, startAt = startAt)

class ScheduleRemindersUseCaseTest {
    private val schedule = ScheduleRemindersUseCase()

    @Test
    fun `critical event arms the full four-stage DND-bypassing ladder`() {
        val start = NOW + 2.hours
        val reminders = schedule(ev(EventPriority.CRITICAL, start), NOW)
        assertEquals(4, reminders.size)
        assertTrue(reminders.all { it.bypassDnd }, "every critical stage bypasses DND")
        assertEquals(
            listOf(AlarmIntensity.GENTLE, AlarmIntensity.FIRM, AlarmIntensity.URGENT, AlarmIntensity.MAX),
            reminders.map { it.intensity },
        )
        // Stages are at -60, -15, -5, 0 relative to start, sorted ascending.
        assertEquals(start - 60.minutes, reminders.first().fireAt)
        assertEquals(start, reminders.last().fireAt)
    }

    @Test
    fun `low priority never alarms`() {
        assertEquals(emptyList(), schedule(ev(EventPriority.LOW, NOW + 2.hours), NOW))
    }

    @Test
    fun `an event with no start time schedules nothing`() {
        assertEquals(emptyList(), schedule(ev(EventPriority.CRITICAL, null), NOW))
    }

    @Test
    fun `past pre-stages are dropped but the at-time MAX still fires for a late critical`() {
        // Event starts in 3 minutes: the -60/-15 stages are already past.
        val start = NOW + 3.minutes
        val reminders = schedule(ev(EventPriority.CRITICAL, start), NOW)
        // -5m stage (past) is dropped; only the still-future -? and the MAX remain.
        assertTrue(reminders.any { it.intensity == AlarmIntensity.MAX }, "the at-time MAX always survives")
        assertTrue(reminders.all { it.fireAt >= NOW || it.intensity == AlarmIntensity.MAX })
    }

    @Test
    fun `high priority arms two escalating non-DND stages`() {
        val reminders = schedule(ev(EventPriority.HIGH, NOW + 2.hours), NOW)
        assertEquals(2, reminders.size)
        assertTrue(reminders.none { it.bypassDnd })
        assertEquals(listOf(AlarmIntensity.FIRM, AlarmIntensity.URGENT), reminders.map { it.intensity })
    }
}
