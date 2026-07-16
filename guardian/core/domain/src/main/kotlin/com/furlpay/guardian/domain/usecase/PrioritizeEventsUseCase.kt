package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

/**
 * Deterministic priority + ordering for the event feed.
 *
 * The AI can PROPOSE a priority, but the feed the user sees is sorted by a
 * transparent rule so it is predictable and testable (an LLM re-ranking the
 * list every refresh would be maddening):
 *
 *   1. Unacknowledged before acknowledged.
 *   2. Higher effective priority first. Effective priority = max(model
 *      priority, time-urgency), so an imminent MEDIUM meeting outranks a
 *      HIGH one that is days away.
 *   3. Sooner startAt first; timeless events (null startAt) sort last within
 *      their bucket.
 *
 * Pure and clock-injectable, so the whole thing is unit-testable.
 */
class PrioritizeEventsUseCase(private val clock: Clock = Clock.System) {

    operator fun invoke(events: List<GuardianEvent>): List<GuardianEvent> {
        val now = clock.now()
        return events.sortedWith(
            compareBy<GuardianEvent> { it.acknowledged }
                .thenByDescending { effectivePriority(it, now).ordinal }
                .thenBy { it.startAt ?: Instant.DISTANT_FUTURE }
                .thenBy { it.title.lowercase() },
        )
    }

    /** The urgency actually used for sorting: never below the model's, but
     *  raised as the clock closes in on a timed event. */
    fun effectivePriority(event: GuardianEvent, now: Instant): EventPriority {
        val timeUrgency = event.startAt?.let { timeUrgency(it - now) } ?: EventPriority.LOW
        return maxOf(event.priority, timeUrgency)
    }

    private fun timeUrgency(untilStart: kotlin.time.Duration): EventPriority = when {
        // Past due, or within 15 min — treat as CRITICAL regardless of source.
        untilStart <= 15.minutes -> EventPriority.CRITICAL
        untilStart <= 1.hours -> EventPriority.HIGH
        untilStart <= 24.hours -> EventPriority.MEDIUM
        else -> EventPriority.LOW
    }

    private companion object {
        /** Source is a tiebreak signal for future weighting; referenced so the
         *  enum stays part of the contract. */
        val TRUSTED_SOURCES = setOf(EventSource.CALENDAR, EventSource.GITHUB)
    }
}
