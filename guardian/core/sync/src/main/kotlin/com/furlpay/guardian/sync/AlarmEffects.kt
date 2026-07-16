package com.furlpay.guardian.sync

import android.media.AudioAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import com.furlpay.guardian.domain.model.AlarmIntensity

/**
 * The alarm-ladder haptic waveforms (design bible §7) — ONE mapping shared by
 * the phone's AlarmService and the watch's WatchAlarmService, so an URGENT
 * stage feels identical on both wrists. Lives in :core:sync because that is
 * the module both device apps already share.
 *
 * USAGE_ALARM is what lets CRITICAL stages punch through Do Not Disturb and
 * Bedtime mode — without it the entire Life Guardian promise silently dies.
 * (`ReminderStage.bypassDnd` decides; the vibrate call honors it.)
 */
object AlarmEffects {

    /** Repeating waveform for a stage — runs until cancel()/ack. */
    fun waveform(intensity: AlarmIntensity): VibrationEffect = when (intensity) {
        // 200ms on / 400ms off — a nudge, not a siren.
        AlarmIntensity.GENTLE -> VibrationEffect.createWaveform(
            longArrayOf(0, 200, 400),
            intArrayOf(0, 160, 0),
            /* repeat from index */ 0,
        )
        // 200ms on / 200ms off — insistent.
        AlarmIntensity.FIRM -> VibrationEffect.createWaveform(
            longArrayOf(0, 200, 200),
            intArrayOf(0, 220, 0),
            0,
        )
        // 300ms on / 150ms off, full amplitude.
        AlarmIntensity.URGENT -> VibrationEffect.createWaveform(
            longArrayOf(0, 300, 150),
            intArrayOf(0, 255, 0),
            0,
        )
        // Near-continuous, maximum — the "you are missing it" stage.
        AlarmIntensity.MAX -> VibrationEffect.createWaveform(
            longArrayOf(0, 800, 100),
            intArrayOf(0, 255, 0),
            0,
        )
    }

    /**
     * Start the stage vibration. The AudioAttributes overload is deprecated in
     * API 33 but is the only one available at minSdk 26 — and USAGE_ALARM on
     * it is still what routes past DND on every supported version.
     */
    @Suppress("DEPRECATION")
    fun start(vibrator: Vibrator?, intensity: AlarmIntensity, bypassDnd: Boolean) {
        val usage = if (bypassDnd) AudioAttributes.USAGE_ALARM
        else AudioAttributes.USAGE_NOTIFICATION_EVENT
        vibrator?.vibrate(
            waveform(intensity),
            AudioAttributes.Builder().setUsage(usage).build(),
        )
    }

    fun stop(vibrator: Vibrator?) {
        vibrator?.cancel()
    }
}
