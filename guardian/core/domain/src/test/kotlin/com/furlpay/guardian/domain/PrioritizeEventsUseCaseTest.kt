package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.usecase.PrioritizeEventsUseCase
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

private val NOW = Instant.parse("2026-07-16T09:00:00Z")
private val fixedClock = object : Clock { override fun now() = NOW }

private fun ev(
    id: String,
    priority: EventPriority = EventPriority.MEDIUM,
    startAt: Instant? = null,
    acknowledged: Boolean = false,
    source: EventSource = EventSource.MANUAL,
) = GuardianEvent(id = id, source = source, title = id, priority = priority, startAt = startAt, acknowledged = acknowledged)

class PrioritizeEventsUseCaseTest {
    private val prioritize = PrioritizeEventsUseCase(fixedClock)

    @Test
    fun `imminent medium meeting outranks a distant high one`() {
        val soonMedium = ev("soon", EventPriority.MEDIUM, startAt = NOW + 10.minutes)
        val distantHigh = ev("distant", EventPriority.HIGH, startAt = NOW + 3.days)
        val ordered = prioritize(listOf(distantHigh, soonMedium))
        // 10 min out => time-urgency CRITICAL, beats a HIGH days away.
        assertEquals("soon", ordered.first().id)
    }

    @Test
    fun `acknowledged events sink below active ones regardless of priority`() {
        val ackedCritical = ev("done", EventPriority.CRITICAL, startAt = NOW + 5.minutes, acknowledged = true)
        val activeLow = ev("todo", EventPriority.LOW, startAt = NOW + 2.days)
        val ordered = prioritize(listOf(ackedCritical, activeLow))
        assertEquals(listOf("todo", "done"), ordered.map { it.id })
    }

    @Test
    fun `effective priority escalates with the clock`() {
        assertEquals(EventPriority.CRITICAL, prioritize.effectivePriority(ev("a", EventPriority.LOW, NOW + 5.minutes), NOW))
        assertEquals(EventPriority.HIGH, prioritize.effectivePriority(ev("b", EventPriority.LOW, NOW + 45.minutes), NOW))
        assertEquals(EventPriority.MEDIUM, prioritize.effectivePriority(ev("c", EventPriority.LOW, NOW + 12.hours), NOW))
        assertEquals(EventPriority.LOW, prioritize.effectivePriority(ev("d", EventPriority.LOW, NOW + 5.days), NOW))
    }

    @Test
    fun `model priority is a floor - never downgraded by a distant time`() {
        // A HIGH event far in the future stays at least HIGH.
        assertEquals(EventPriority.HIGH, prioritize.effectivePriority(ev("x", EventPriority.HIGH, NOW + 5.days), NOW))
    }

    @Test
    fun `timeless events sort after timed ones of equal priority`() {
        val timed = ev("timed", EventPriority.MEDIUM, startAt = NOW + 20.hours)
        val timeless = ev("timeless", EventPriority.MEDIUM, startAt = null)
        val ordered = prioritize(listOf(timeless, timed))
        assertEquals(listOf("timed", "timeless"), ordered.map { it.id })
    }
}
