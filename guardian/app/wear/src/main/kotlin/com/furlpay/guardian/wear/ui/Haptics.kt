package com.furlpay.guardian.wear.ui

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * The FurlPay haptic vocabulary (design bible §7). Every press answers with
 * touch; the STRENGTH of the pulse encodes the WEIGHT of the action:
 *
 *   click        — any button press (~10ms, light)
 *   heavyClick   — a financial state change committed (card frozen)
 *   doubleClick  — money arrived / response landed
 *   tick         — passive state transition (response card reveal)
 *   error        — 3 short pulses: something needs your eyes
 *
 * Alarm-ladder waveforms (USAGE_ALARM, DND-bypassing) live with the alarm
 * service, not here — these are interaction haptics only.
 */
class Haptics(private val vibrator: Vibrator?) {

    fun click() = predefined(VibrationEffect.EFFECT_CLICK)
    fun heavyClick() = predefined(VibrationEffect.EFFECT_HEAVY_CLICK)
    fun doubleClick() = predefined(VibrationEffect.EFFECT_DOUBLE_CLICK)
    fun tick() = predefined(VibrationEffect.EFFECT_TICK)

    /** 3 × 100ms pulses — the "look at the watch" pattern for errors. */
    fun error() {
        vibrator?.vibrate(
            VibrationEffect.createWaveform(
                longArrayOf(0, 100, 100, 100, 100, 100),
                intArrayOf(0, 180, 0, 180, 0, 180),
                -1, // no repeat
            ),
        )
    }

    private fun predefined(effect: Int) {
        vibrator?.vibrate(VibrationEffect.createPredefined(effect))
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val context = LocalContext.current
    return remember { Haptics(context.getSystemService(Vibrator::class.java)) }
}

fun Context.haptics(): Haptics = Haptics(getSystemService(Vibrator::class.java))
