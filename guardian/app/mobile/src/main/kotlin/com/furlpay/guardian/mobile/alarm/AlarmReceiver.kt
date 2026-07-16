package com.furlpay.guardian.mobile.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.furlpay.guardian.domain.usecase.ScheduledReminder

/** An armed rung fired — hand it to the foreground AlarmService to ring. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE) return
        val service = Intent(context, AlarmService::class.java)
            .setAction(AlarmService.ACTION_RING)
            .putExtras(intent)
        ContextCompat.startForegroundService(context, service)
    }

    companion object {
        const val ACTION_FIRE = "com.furlpay.guardian.ALARM_FIRE"
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_TITLE = "title"
        const val EXTRA_INTENSITY = "intensity"
        const val EXTRA_BYPASS_DND = "bypassDnd"

        fun intent(context: Context, title: String, reminder: ScheduledReminder): Intent =
            Intent(context, AlarmReceiver::class.java)
                .setAction(ACTION_FIRE)
                .putExtra(EXTRA_EVENT_ID, reminder.eventId)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_INTENSITY, reminder.intensity.name)
                .putExtra(EXTRA_BYPASS_DND, reminder.bypassDnd)
    }
}
