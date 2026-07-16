package com.furlpay.guardian.mobile.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.furlpay.guardian.mobile.mobileServices
import com.furlpay.guardian.network.dto.RegisterDeviceRequest
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.runBlocking

/**
 * FCM client for the server's existing delivery pipeline (apps/web
 * lib/fcm.ts + POST /api/push/devices). Dormant until google-services.json
 * ships — FirebaseApp never initializes, so this service is never bound.
 */
class GuardianMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // Best-effort: requires a signed-in session; re-registration happens
        // on the next app start otherwise.
        runBlocking {
            runCatching {
                applicationContext.mobileServices.client.api.registerDevice(
                    RegisterDeviceRequest(token = token, device = "android-guardian"),
                )
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) return

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Guardian alerts", NotificationManager.IMPORTANCE_HIGH),
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(message.notification?.title ?: "FurlPay Guardian")
            .setContentText(message.notification?.body ?: message.data["body"] ?: "")
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(this)
            .notify(message.messageId.hashCode(), notification)
    }

    private companion object {
        const val CHANNEL_ID = "guardian_alerts"
    }
}
