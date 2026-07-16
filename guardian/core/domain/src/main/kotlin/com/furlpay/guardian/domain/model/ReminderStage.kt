package com.furlpay.guardian.domain.model

import kotlin.time.Duration

/**
 * One rung of the multi-stage alarm escalation. A CRITICAL event fires a
 * sequence of these leading up to (and past) `startAt`, each louder than the
 * last, until the user acknowledges. `offset` is relative to the event time:
 * negative = before it, zero/positive = at or after.
 */
data class ReminderStage(
    val offset: Duration,
    val intensity: AlarmIntensity,
    /** Whether this stage bypasses Do Not Disturb (USAGE_ALARM). */
    val bypassDnd: Boolean,
)

/** How forcefully a stage alerts. Maps to haptic waveform + sound on-device. */
enum class AlarmIntensity { GENTLE, FIRM, URGENT, MAX }
