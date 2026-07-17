package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.viewmodel.WalletViewModel

/**
 * Balances, largest first. Answers "how much do I have?" and nothing else.
 * Rows are display-only ([InfoCard] — no fake button semantics); the one
 * action here is Receive, on the edge-hugging button.
 */
@Composable
fun WalletScreen(
    onReceive: () -> Unit = {},
    viewModel: WalletViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val haptics = rememberHaptics()

    ScreenScaffold(
        scrollState = columnState,
        edgeButton = {
            EdgeButton(
                onClick = { haptics.click(); onReceive() },
                buttonSize = EdgeButtonSize.Small,
            ) {
                GlyphIcon(
                    GuardianGlyph.Qr,
                    size = 16.dp,
                    tint = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Receive")
            }
        },
    ) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                if (state.loading) {
                    SkeletonAmount()
                } else {
                    Text(
                        text = usd(animatedUsd(state.totalUsd)),
                        style = MaterialTheme.typography.displaySmall,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            if (state.stale) {
                item {
                    Text(
                        text = "offline · cached",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            state.error?.let { error ->
                item {
                    Text(
                        text = error,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            items(state.wallets.size) { index ->
                val wallet = state.wallets[index]
                InfoCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = wallet.currency + (wallet.chain?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = usd(wallet.usdValue),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
