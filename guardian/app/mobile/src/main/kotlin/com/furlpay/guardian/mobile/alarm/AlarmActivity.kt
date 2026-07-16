package com.furlpay.guardian.mobile.alarm

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Full-screen over the lock screen: what's happening and ONE action —
 * acknowledge (spring-bounce entrance per the motion bible). Dismissing
 * without acknowledging leaves the ladder armed, by design.
 */
class AlarmActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        val eventId = intent.getStringExtra(AlarmReceiver.EXTRA_EVENT_ID) ?: run { finish(); return }
        val title = intent.getStringExtra(AlarmReceiver.EXTRA_TITLE) ?: "Guardian reminder"
        val intensity = intent.getStringExtra(AlarmReceiver.EXTRA_INTENSITY) ?: "FIRM"

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                val buttonScale by animateFloatAsState(
                    targetValue = 1f,
                    animationSpec = spring(
                        stiffness = Spring.StiffnessLow,
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                    ),
                    label = "ack-bounce",
                )
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black)
                        .padding(32.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = if (intensity == "MAX") "⏰ NOW" else "⏰ Reminder",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text(
                        text = title,
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                    )
                    Button(
                        onClick = {
                            startService(
                                Intent(this@AlarmActivity, AlarmService::class.java)
                                    .setAction(AlarmService.ACTION_ACK)
                                    .putExtra(AlarmReceiver.EXTRA_EVENT_ID, eventId),
                            )
                            finish()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .scale(0.8f + 0.2f * buttonScale),
                    ) {
                        Text("Acknowledge", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }

    companion object {
        fun intent(context: Context, eventId: String, title: String, intensity: String): Intent =
            Intent(context, AlarmActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(AlarmReceiver.EXTRA_EVENT_ID, eventId)
                .putExtra(AlarmReceiver.EXTRA_TITLE, title)
                .putExtra(AlarmReceiver.EXTRA_INTENSITY, intensity)
    }
}
