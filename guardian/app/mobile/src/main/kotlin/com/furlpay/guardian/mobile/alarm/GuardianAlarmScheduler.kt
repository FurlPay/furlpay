package com.furlpay.guardian.mobile.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.usecase.ScheduleRemindersUseCase
import com.furlpay.guardian.domain.usecase.ScheduledReminder
import kotlinx.datetime.Clock

/**
 * Arms the escalation ladder ScheduleRemindersUseCase decides. The use case
 * is the tested policy (which stages, when, how loud); this class is only the
 * AlarmManager plumbing.
 *
 * Armed alarms are tracked in-memory per event so an acknowledgement cancels
 * the REMAINING rungs — "escalate until acknowledged" also means "stop when
 * acknowledged". Process death loses the map; re-arming on the next sync
 * re-registers pending stages (idempotent: same request codes).
 */
class GuardianAlarmScheduler(private val context: Context) {

    private val alarmManager = context.getSystemService(AlarmManager::class.java)
    private val schedule = ScheduleRemindersUseCase()

    /** eventId → pending intents armed for it (for cancellation). */
    private val armed = mutableMapOf<String, MutableList<PendingIntent>>()

    /** Events whose past-due MAX rung already fired — never refire on re-sync. */
    private val lateFired = mutableSetOf<String>()

    /** (Re-)arm ladders for all alertable events. Call after every event sync. */
    @Synchronized
    fun armForEvents(events: List<GuardianEvent>) {
        val now = Clock.System.now()
        events
            .filter { !it.acknowledged }
            .forEach { event ->
                schedule(event, now).forEach { reminder ->
                    if (reminder.fireAt >= now) {
                        arm(event, reminder)
                    } else if (lateFired.add(reminder.eventId)) {
                        // The use case keeps the at-time MAX even when it's
                        // past (late arm still alerts) — fire it now, once.
                        context.sendBroadcast(AlarmReceiver.intent(context, event.title, reminder))
                    }
                }
            }
    }

    private fun arm(event: GuardianEvent, reminder: ScheduledReminder) {
        val pending = PendingIntent.getBroadcast(
            context,
            requestCode(reminder),
            AlarmReceiver.intent(context, event.title, reminder),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Exact while-idle: a reminder that slips past a Doze window is a
        // missed meeting. USE_EXACT_ALARM covers the permission (alarm app).
        if (canExact()) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                reminder.fireAt.toEpochMilliseconds(),
                pending,
            )
        } else {
            alarmManager.setWindow(
                AlarmManager.RTC_WAKEUP,
                reminder.fireAt.toEpochMilliseconds(),
                60_000L,
                pending,
            )
        }
        armed.getOrPut(reminder.eventId) { mutableListOf() }.add(pending)
    }

    /** Acknowledged — tear down every remaining rung for this event. */
    @Synchronized
    fun cancelEvent(eventId: String) {
        lateFired.add(eventId) // never late-fire an acknowledged event
        armed.remove(eventId)?.forEach { pending ->
            alarmManager.cancel(pending)
            pending.cancel()
        }
    }

    private fun canExact(): Boolean =
        runCatching { alarmManager.canScheduleExactAlarms() }.getOrDefault(true)

    private fun requestCode(reminder: ScheduledReminder): Int =
        (reminder.eventId + "@" + reminder.fireAt.toEpochMilliseconds()).hashCode()
}
