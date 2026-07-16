package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.viewmodel.CardsViewModel

/**
 * Card safety. Freeze = tap, tap again to confirm (protective direction).
 * Unfreeze deliberately bounces to the phone's biometric.
 */
@Composable
fun CardsScreen(viewModel: CardsViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val haptics = rememberHaptics()

    // Play the one-shot cue the ViewModel attached to the last state change:
    // CLICK arms the freeze, HEAVY confirms it, ERROR says look at the screen.
    LaunchedEffect(state.haptic) {
        when (state.haptic) {
            CardsViewModel.HapticCue.CLICK -> haptics.click()
            CardsViewModel.HapticCue.HEAVY -> haptics.heavyClick()
            CardsViewModel.HapticCue.ERROR -> haptics.error()
            null -> {}
        }
        if (state.haptic != null) viewModel.onHapticPlayed()
    }

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                Text(
                    text = "Cards",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            state.message?.let { message ->
                item {
                    Text(
                        text = message,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            items(state.cards.size) { index ->
                val card = state.cards[index]
                val pending = state.pendingFreezeId == card.id
                Card(
                    onClick = { viewModel.onCardTapped(card) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = (card.label ?: card.kind) + " …" + card.last4,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = when {
                            pending -> "Tap again to freeze"
                            card.frozen -> "Frozen — unfreeze on phone"
                            else -> "Active · tap to freeze"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = when {
                            pending -> MaterialTheme.colorScheme.tertiary
                            card.frozen -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
    }
}
