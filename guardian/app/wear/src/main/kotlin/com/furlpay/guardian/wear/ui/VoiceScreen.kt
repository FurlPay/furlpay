package com.furlpay.guardian.wear.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.EaseInOutCubic
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.viewmodel.VoiceViewModel

/**
 * Ask Guardian. Button-triggered system SpeechRecognizer — NO always-listening
 * wake word (battery). Motion per the design bible §3/§9:
 *   LISTENING  → pulsing ring synced to a breathe cycle
 *   RESPONDING → spring scale-in card (low stiffness, slight bounce) + tick
 *   ERROR      → error haptic pattern; tap to retry
 */
@Composable
fun VoiceScreen(viewModel: VoiceViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val text = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (result.resultCode == Activity.RESULT_OK && text != null) {
            viewModel.onSpeech(text)
        } else {
            viewModel.onSpeechCancelled()
        }
    }

    fun startListening() {
        haptics.click()
        viewModel.onListening()
        speechLauncher.launch(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask Guardian")
            },
        )
    }

    // One haptic per state ARRIVAL (keyed on the state itself, not recompositions).
    LaunchedEffect(state) {
        when (state) {
            is VoiceViewModel.UiState.Responding -> haptics.doubleClick() // answer landed
            is VoiceViewModel.UiState.Error -> haptics.error()
            else -> {}
        }
    }

    ScreenScaffold {
        Box(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                is VoiceViewModel.UiState.Idle -> Button(
                    onClick = ::startListening,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        GlyphIcon(GuardianGlyph.Mic, tint = MaterialTheme.colorScheme.onSurface)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Tap to speak", textAlign = TextAlign.Center)
                    }
                }

                is VoiceViewModel.UiState.Listening -> ListeningRing()

                is VoiceViewModel.UiState.Processing -> {
                    CircularProgressIndicator()
                    Text(
                        text = "Thinking…",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 20.dp),
                    )
                }

                is VoiceViewModel.UiState.Responding -> SpringInCard {
                    Card(
                        onClick = viewModel::dismissResponse,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            GlyphIcon(domainGlyph(current.kind), size = 16.dp)
                            Text(
                                text = current.text,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }

                is VoiceViewModel.UiState.Error -> Card(
                    onClick = ::startListening,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = current.message + "\nTap to try again.",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/** Pulsing ring while the recognizer listens — breathe in/out, no strobe. */
@Composable
private fun ListeningRing() {
    val transition = rememberInfiniteTransition(label = "listen-pulse")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.3f,
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
                .size(96.dp)
                .scale(scale)
                .border(
                    width = 3.dp,
                    color = MaterialTheme.colorScheme.primary.copy(alpha = ringAlpha),
                    shape = CircleShape,
                ),
        )
        GlyphIcon(GuardianGlyph.Mic, size = 28.dp)
    }
}

/** Spring scale/fade-in — low stiffness, slight bounce (bible: playful reveal). */
@Composable
private fun SpringInCard(content: @Composable () -> Unit) {
    val revealed by animateFloatAsState(
        targetValue = 1f,
        animationSpec = spring(
            stiffness = Spring.StiffnessLow,
            dampingRatio = Spring.DampingRatioMediumBouncy,
        ),
        label = "card-reveal",
    )
    Box(
        modifier = Modifier
            .scale(0.85f + 0.15f * revealed)
            .alpha(revealed),
    ) {
        content()
    }
}

/** Domain hint → response-card glyph (bible §9 visual states, no emoji). */
private fun domainGlyph(kind: String): GuardianGlyph = when (kind) {
    "wallet" -> GuardianGlyph.Wallet
    "card" -> GuardianGlyph.Card
    "event" -> GuardianGlyph.Bars
    "travel" -> GuardianGlyph.Plane
    "error" -> GuardianGlyph.Shield
    else -> GuardianGlyph.Mic
}
