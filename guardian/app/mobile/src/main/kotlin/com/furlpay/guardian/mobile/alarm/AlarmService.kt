package com.furlpay.guardian.mobile.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import com.furlpay.guardian.domain.model.AlarmIntensity
import com.furlpay.guardian.mobile.mobileServices
import com.furlpay.guardian.sync.AlarmEffects
import com.furlpay.guardian.sync.AlarmSignal
import com.furlpay.guardian.sync.SyncProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The ringing state. One rung at a time: haptic waveform per intensity
 * (USAGE_ALARM → punches DND), full-screen notification, and a mirrored
 * AlarmSignal to the watch so both wrists buzz. ACTION_ACK from anywhere —
 * notification action, AlarmActivity, or the watch — silences everything and
 * cancels the event's remaining rungs.
 */
class AlarmService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var vibrator: Vibrator? = null
    private var currentEventId: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        vibrator = getSystemService(Vibrator::class.java)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_RING -> ring(intent)
            ACTION_ACK -> acknowledge(intent.getStringExtra(AlarmReceiver.EXTRA_EVENT_ID))
        }
        return START_NOT_STICKY
    }

    private fun ring(intent: Intent) {
        val eventId = intent.getStringExtra(AlarmReceiver.EXTRA_EVENT_ID) ?: return stopSelf()
        val title = intent.getStringExtra(AlarmReceiver.EXTRA_TITLE) ?: "Guardian reminder"
        val intensity = intent.getStringExtra(AlarmReceiver.EXTRA_INTENSITY)
            ?.let { runCatching { AlarmIntensity.valueOf(it) }.getOrNull() }
            ?: AlarmIntensity.FIRM
        val bypassDnd = intent.getBooleanExtra(AlarmReceiver.EXTRA_BYPASS_DND, false)
        currentEventId = eventId

        startInForeground(buildNotification(eventId, title, intensity))
        AlarmEffects.start(vibrator, intensity, bypassDnd)

        // Mirror to the watch — same ladder, same moment.
        scope.launch {
            runCatching {
                val signal = AlarmSignal(
                    eventId = eventId,
                    title = title,
                    intensity = intensity.name,
                    bypassDnd = bypassDnd,
                    atMs = System.currentTimeMillis(),
                )
                services().messages.send(
                    SyncProtocol.MSG_ALARM,
                    SyncProtocol.json.encodeToString(AlarmSignal.serializer(), signal).encodeToByteArray(),
                )
            }
        }
    }

    private fun acknowledge(eventId: String?) {
        AlarmEffects.stop(vibrator)
        eventId?.let { id ->
            services().alarmScheduler.cancelEvent(id)
            scope.launch {
                runCatching { services().eventRepo.acknowledge(id) }
                // Silence the watch too.
                runCatching {
                    val ack = com.furlpay.guardian.sync.AlarmAck(id, System.currentTimeMillis())
                    services().messages.send(
                        SyncProtocol.MSG_ALARM_ACK,
                        SyncProtocol.json.encodeToString(
                            com.furlpay.guardian.sync.AlarmAck.serializer(), ack,
                        ).encodeToByteArray(),
                    )
                }
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(eventId: String, title: String, intensity: AlarmIntensity): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Guardian alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null) // we own the haptics; no duplicate din
                enableVibration(false)
            },
        )

        val fullScreen = PendingIntent.getActivity(
            this,
            eventId.hashCode(),
            AlarmActivity.intent(this, eventId, title, intensity.name),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val ack = PendingIntent.getService(
            this,
            eventId.hashCode() + 1,
            Intent(this, AlarmService::class.java)
                .setAction(ACTION_ACK)
                .putExtra(AlarmReceiver.EXTRA_EVENT_ID, eventId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText("Guardian ${intensity.name.lowercase()} reminder — tap to acknowledge")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .addAction(0, "Acknowledge", ack)
            .build()
    }

    private fun services() = applicationContext.mobileServices

    override fun onDestroy() {
        AlarmEffects.stop(vibrator)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_RING = "com.furlpay.guardian.alarm.RING"
        const val ACTION_ACK = "com.furlpay.guardian.alarm.ACK"
        private const val CHANNEL_ID = "guardian_alarm"
        private const val NOTIFICATION_ID = 0x6A1
    }
}
