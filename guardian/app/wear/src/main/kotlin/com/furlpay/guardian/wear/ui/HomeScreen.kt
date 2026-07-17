package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.viewmodel.HomeViewModel

/**
 * The 5-second glance: total balance headline, what's next, five actions.
 * One screen, one job — never a shrunken phone dashboard. Every press clicks
 * (haptic vocabulary §7).
 */
@Composable
fun HomeScreen(
    navController: NavController,
    viewModel: HomeViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val haptics = rememberHaptics()

    fun navigate(route: String) {
        haptics.click()
        navController.navigate(route)
    }

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    FurlPayMark(size = 16.dp)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "FurlPay",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item {
                Text(
                    text = when {
                        state.loading -> "…"
                        state.signedOut -> "Open FurlPay on your phone to sync"
                        state.totalUsd != null -> usd(state.totalUsd!!)
                        else -> "No data yet"
                    },
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
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
            state.nextEventTitle?.let { title ->
                item {
                    Text(
                        text = "Next: $title",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            state.nextTripTitle?.let { title ->
                item {
                    Text(
                        text = "Trip: $title",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item { HomeAction("Markets", GuardianGlyph.Chart) { navigate(Routes.MARKETS) } }
            item { HomeAction("Wallet", GuardianGlyph.Wallet) { navigate(Routes.WALLET) } }
            item { HomeAction("Cards", GuardianGlyph.Card) { navigate(Routes.CARDS) } }
            item { HomeAction("Portfolio", GuardianGlyph.Shield) { navigate(Routes.PORTFOLIO) } }
            item { HomeAction("Spending", GuardianGlyph.Bars) { navigate(Routes.SPENDING) } }
            item { HomeAction("Travel", GuardianGlyph.Plane) { navigate(Routes.TRAVEL) } }
            item { HomeAction("Receive", GuardianGlyph.Qr) { navigate(Routes.QUICKPAY) } }
            item { HomeAction("Ask Guardian", GuardianGlyph.Mic) { navigate(Routes.VOICE) } }
        }
    }
}

/**
 * One action row — leading mint glyph on the deep-teal surface (mockups'
 * "SYNC STATE" face), never a filled-primary slab. No emoji.
 */
@Composable
private fun HomeAction(label: String, glyph: GuardianGlyph, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.filledTonalButtonColors(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            GlyphIcon(glyph)
            Spacer(modifier = Modifier.width(8.dp))
            Text(label, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
