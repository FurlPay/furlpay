package com.furlpay.guardian.mobile.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.furlpay.guardian.domain.taptopay.TapToPayAvailability
import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable
import com.furlpay.guardian.mobile.taptopay.TapToPayEnvironment
import com.furlpay.guardian.mobile.viewmodel.TapToPayViewModel
import java.text.NumberFormat
import java.util.Locale

/**
 * The merchant terminal. Mirrors TapToPayView.swift.
 *
 * Used standing up, at a counter, with a customer waiting. That constrains the
 * layout more than any style guide: the amount is the largest thing on screen,
 * the keypad is thumb-reachable, and every state change is legible at arm's
 * length. Nothing here scrolls.
 */
@Composable
fun TapToPayScreen(viewModel: TapToPayViewModel, onClose: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AmountDisplay(state)

        Spacer(Modifier.height(8.dp))

        when (val phase = state.phase) {
            TapToPayViewModel.Phase.Idle -> {
                Spacer(Modifier.weight(1f))
                Keypad(onPress = viewModel::press)
                Spacer(Modifier.height(12.dp))
                ChargeButton(state, onCharge = viewModel::charge)
                // NFC is the one blocker the merchant can fix in ten seconds,
                // so it gets a button rather than a sentence.
                if (state.availability.blockedBy() == TapToPayUnavailable.NfcDisabled) {
                    TextButton(onClick = {
                        context.startActivity(TapToPayEnvironment.nfcSettingsIntent())
                    }) { Text("Open NFC settings") }
                }
            }

            TapToPayViewModel.Phase.Preparing -> StatusPanel(
                glyph = "⋯", tint = MaterialTheme.colorScheme.onSurfaceVariant,
                title = "Getting ready", detail = null, pulsing = true,
            )

            TapToPayViewModel.Phase.WaitingForTap -> StatusPanel(
                glyph = "◉", tint = MaterialTheme.colorScheme.primary,
                title = "Ask the customer to tap",
                detail = "Hold their card, phone or watch to the back of your phone.",
                pulsing = true,
            )

            TapToPayViewModel.Phase.Authorising -> StatusPanel(
                glyph = "◉", tint = MaterialTheme.colorScheme.primary,
                title = "Authorising", detail = "Don't move the card.", pulsing = true,
            )

            is TapToPayViewModel.Phase.Succeeded -> {
                StatusPanel(
                    glyph = "✓", tint = MaterialTheme.colorScheme.tertiary,
                    title = "Paid ${formatUsd(phase.result.amount.toDouble())}",
                    detail = phase.result.cardDescription, pulsing = false,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = viewModel::newSale) { Text("New sale") }
            }

            is TapToPayViewModel.Phase.Failed -> {
                StatusPanel(
                    glyph = "!", tint = MaterialTheme.colorScheme.error,
                    title = "Not taken", detail = phase.message, pulsing = false,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // Retry keeps the SAME idempotency key — this is the same
                    // sale, and the server must be able to tell.
                    if (phase.recoverable) {
                        Button(onClick = viewModel::charge) { Text("Try again") }
                    }
                    OutlinedButton(onClick = viewModel::newSale) { Text("New sale") }
                }
            }
        }

        Spacer(Modifier.weight(1f))
        TextButton(onClick = onClose) { Text("Done") }
    }
}

@Composable
private fun AmountDisplay(state: TapToPayViewModel.UiState) {
    val amount = formatUsd(state.amount.toDouble())
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 28.dp)
            // One announcement, not three. A screen reader reading the digits
            // and the warning separately at a counter is unusable.
            .clearAndSetSemantics { contentDescription = "Amount $amount" },
    ) {
        Text(
            text = amount,
            fontSize = 52.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (state.minorUnits > 0) {
                MaterialTheme.colorScheme.onBackground
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        state.availability.blockedBy()?.let { reason ->
            Text(
                text = TapToPayViewModel.titleFor(reason),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

@Composable
private fun Keypad(onPress: (String) -> Unit) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("", "0", TapToPayViewModel.BACKSPACE),
    )
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { key ->
                    if (key.isEmpty()) {
                        Spacer(Modifier.weight(1f).height(56.dp))
                    } else {
                        OutlinedButton(
                            onClick = { onPress(key) },
                            modifier = Modifier.weight(1f).height(56.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Text(
                                text = key,
                                style = MaterialTheme.typography.titleLarge,
                                modifier = Modifier.clearAndSetSemantics {
                                    contentDescription =
                                        if (key == TapToPayViewModel.BACKSPACE) "Delete" else key
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChargeButton(state: TapToPayViewModel.UiState, onCharge: () -> Unit) {
    Button(
        onClick = onCharge,
        enabled = state.canCharge,
        modifier = Modifier.fillMaxWidth().height(54.dp),
    ) {
        Text(
            if (state.minorUnits > 0) {
                "Charge ${formatUsd(state.amount.toDouble())}"
            } else {
                "Enter an amount"
            },
        )
    }
}

@Composable
private fun StatusPanel(
    glyph: String,
    tint: Color,
    title: String,
    detail: String?,
    pulsing: Boolean,
) {
    // Breathe, never strobe — the same rule as the watch skeleton and the iOS
    // status panel.
    val transition = rememberInfiniteTransition(label = "status")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (pulsing) 1.10f else 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "status-pulse",
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 32.dp, horizontal = 20.dp),
    ) {
        Box(
            modifier = Modifier.size(64.dp).scale(scale),
            contentAlignment = Alignment.Center,
        ) {
            Text(glyph, fontSize = 44.sp, color = tint)
        }
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        detail?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun TapToPayAvailability.blockedBy(): TapToPayUnavailable? =
    (this as? TapToPayAvailability.Unavailable)?.reason

/**
 * en_US on purpose: these strings are asserted in tests and read aloud by a
 * US-English screen reader. A device in a comma-decimal locale must not
 * silently change what the merchant sees at the counter.
 */
private fun formatUsd(value: Double): String =
    NumberFormat.getCurrencyInstance(Locale.US).format(value)
