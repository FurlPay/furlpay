package com.furlpay.guardian.domain.usecase

import com.furlpay.guardian.domain.model.DailyBriefing
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.GuardianEvent
import kotlinx.datetime.Clock
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn

/**
 * Builds the structured half of the morning briefing. The AI prose (`summary`)
 * is generated separately and passed in; the COUNTS and the lead event are
 * computed here so the numbers are always correct even if the model's text
 * disagrees. `topEvent` uses the same effective-priority ranking as the feed.
 */
class GenerateBriefingUseCase(
    private val prioritize: PrioritizeEventsUseCase = PrioritizeEventsUseCase(),
    private val clock: Clock = Clock.System,
    private val zone: TimeZone = TimeZone.currentSystemDefault(),
) {

    operator fun invoke(events: List<GuardianEvent>, summary: String): DailyBriefing {
        val today: LocalDate = clock.todayIn(zone)
        val active = events.filterNot { it.acknowledged }
        val ordered = prioritize(active)
        return DailyBriefing(
            date = today,
            summary = summary,
            eventCount = active.size,
            criticalCount = active.count {
                prioritize.effectivePriority(it, clock.now()) == EventPriority.CRITICAL
            },
            topEvent = ordered.firstOrNull(),
        )
    }
}
