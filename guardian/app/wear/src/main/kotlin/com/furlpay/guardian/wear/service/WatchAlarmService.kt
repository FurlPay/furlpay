package com.furlpay.guardian.wear.service

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
import com.furlpay.guardian.sync.AlarmAck
import com.furlpay.guardian.sync.AlarmEffects
import com.furlpay.guardian.sync.AlarmSignal
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Watch half of the alarm ladder: same AlarmEffects waveform as the phone
 * (an URGENT rung feels identical on both wrists), ongoing notification with
 * an Acknowledge action. Acking HERE messages the phone so it silences too.
 *
 * shortService type: a wrist buzz that lasts 3 minutes unacknowledged has
 * done its job — the phone keeps escalating regardless.
 */
class WatchAlarmService : Service() {

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
            ACTION_ACK -> acknowledge(notifyPhone = true)
            ACTION_SILENCE -> acknowledge(notifyPhone = false) // phone already knows
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int) {
        // shortService 3-minute cap: stop buzzing, leave the phone escalating.
        AlarmEffects.stop(vibrator)
        stopSelf()
    }

    private fun ring(intent: Intent) {
        val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return stopSelf()
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Guardian reminder"
        val intensity = intent.getStringExtra(EXTRA_INTENSITY)
            ?.let { runCatching { AlarmIntensity.valueOf(it) }.getOrNull() }
            ?: AlarmIntensity.FIRM
        val bypassDnd = intent.getBooleanExtra(EXTRA_BYPASS_DND, false)
        currentEventId = eventId

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(eventId, title),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, buildNotification(eventId, title))
        }
        AlarmEffects.start(vibrator, intensity, bypassDnd)
    }

    private fun acknowledge(notifyPhone: Boolean) {
        AlarmEffects.stop(vibrator)
        val eventId = currentEventId
        if (notifyPhone && eventId != null) {
            scope.launch {
                runCatching {
                    val ack = AlarmAck(eventId, System.currentTimeMillis())
                    applicationContext.wearServices.messages.send(
                        SyncProtocol.MSG_ALARM_ACK,
                        SyncProtocol.json.encodeToString(AlarmAck.serializer(), ack).encodeToByteArray(),
                    )
                }
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(eventId: String, title: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Guardian alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false) // AlarmEffects owns the waveform
            },
        )
        val ack = PendingIntent.getService(
            this,
            eventId.hashCode(),
            Intent(this, WatchAlarmService::class.java).setAction(ACTION_ACK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText("Tap to acknowledge")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(ack)
            .addAction(0, "Acknowledge", ack)
            .build()
    }

    override fun onDestroy() {
        AlarmEffects.stop(vibrator)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_RING = "com.furlpay.guardian.wear.alarm.RING"
        const val ACTION_ACK = "com.furlpay.guardian.wear.alarm.ACK"
        const val ACTION_SILENCE = "com.furlpay.guardian.wear.alarm.SILENCE"
        const val EXTRA_EVENT_ID = "eventId"
        const val EXTRA_TITLE = "title"
        const val EXTRA_INTENSITY = "intensity"
        const val EXTRA_BYPASS_DND = "bypassDnd"
        private const val CHANNEL_ID = "guardian_alarm"
        private const val NOTIFICATION_ID = 0x6A2

        fun ringIntent(context: Context, signal: AlarmSignal): Intent =
            Intent(context, WatchAlarmService::class.java)
                .setAction(ACTION_RING)
                .putExtra(EXTRA_EVENT_ID, signal.eventId)
                .putExtra(EXTRA_TITLE, signal.title)
                .putExtra(EXTRA_INTENSITY, signal.intensity)
                .putExtra(EXTRA_BYPASS_DND, signal.bypassDnd)
    }
}
