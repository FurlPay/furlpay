package com.furlpay.guardian.mobile.ui

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.EaseInOutCubic
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.furlpay.guardian.mobile.viewmodel.LiveVoiceViewModel

/**
 * Guardian Live — bidirectional voice on the phone. Same motion language as
 * the watch VoiceScreen (breathe-cycle pulsing ring, no strobe). The session
 * is read-only: no tools are declared, so Gemini can answer but never act.
 */
@Composable
fun LiveVoiceScreen(
    onBack: () -> Unit,
    viewModel: LiveVoiceViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) viewModel.start() }

    BackHandler(onBack = onBack)

    // The ViewModel outlives this screen (activity-scoped) — end the session
    // whenever the screen leaves composition, not just on back.
    DisposableEffect(Unit) {
        onDispose { viewModel.stop() }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Guardian Live", style = MaterialTheme.typography.headlineSmall)
            Spacer(modifier = Modifier.weight(1f))
            OutlinedButton(onClick = onBack) { Text("Back") }
        }

        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            when (val current = state) {
                is LiveVoiceViewModel.UiState.Idle -> Button(
                    onClick = { micLauncher.launch(Manifest.permission.RECORD_AUDIO) },
                ) {
                    Text("🎤  Start voice chat")
                }

                is LiveVoiceViewModel.UiState.Connecting -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CircularProgressIndicator()
                    Text(
                        "Connecting…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is LiveVoiceViewModel.UiState.Live -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(32.dp),
                ) {
                    LivePulseRing()
                    Text(
                        "Listening — just talk.",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Button(onClick = viewModel::stop) { Text("End conversation") }
                }

                is LiveVoiceViewModel.UiState.Error -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text(
                        current.message,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(
                        onClick = { micLauncher.launch(Manifest.permission.RECORD_AUDIO) },
                    ) {
                        Text("Try again")
                    }
                }
            }
        }

        Text(
            "Guardian can answer questions here but can never move money — " +
                "actions always come back to the screen for approval.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** Breathe-cycle pulsing ring while the session is live (watch VoiceScreen motion). */
@Composable
private fun LivePulseRing() {
    val transition = rememberInfiniteTransition(label = "live-pulse")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ring-scale",
    )
    val ringAlpha by transition.animateFloat(
        initialValue = 0.8f,
        targetValue = 0.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ring-alpha",
    )

    Box(contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .size(140.dp)
                .scale(scale)
                .border(
                    width = 4.dp,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = ringAlpha),
                    shape = CircleShape,
                ),
        )
        Text(text = "🎤", style = MaterialTheme.typography.headlineLarge)
    }
}
