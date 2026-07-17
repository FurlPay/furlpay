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
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.viewmodel.HomeViewModel

/**
 * The 5-second glance: total balance headline, what's next, five actions.
 * One screen, one job — never a shrunken phone dashboard. Every press clicks
 * (haptic vocabulary §7). Action rows morph along the round edge (M3
 * Expressive scroll transformations); Ask Guardian lives on the [EdgeButton]
 * hugging the display's curve — the screen's one primary action.
 */
@Composable
fun HomeScreen(
    navController: NavController,
    viewModel: HomeViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    val haptics = rememberHaptics()

    fun navigate(route: String) {
        haptics.click()
        navController.navigate(route)
    }

    ScreenScaffold(
        scrollState = columnState,
        edgeButton = {
            EdgeButton(
                onClick = { navigate(Routes.VOICE) },
                buttonSize = EdgeButtonSize.Medium,
            ) {
                GlyphIcon(
                    GuardianGlyph.Mic,
                    size = 16.dp,
                    tint = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Ask Guardian")
            }
        },
    ) { contentPadding ->
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
                when {
                    state.loading -> SkeletonAmount()
                    state.signedOut -> Text(
                        text = "Open FurlPay on your phone to sync",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    state.totalUsd != null -> Text(
                        text = usd(animatedUsd(state.totalUsd!!)),
                        style = MaterialTheme.typography.displaySmall,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    else -> Text(
                        text = "No data yet",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
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
            homeAction("Markets", GuardianGlyph.Chart, transformationSpec) { navigate(Routes.MARKETS) }
            homeAction("Wallet", GuardianGlyph.Wallet, transformationSpec) { navigate(Routes.WALLET) }
            homeAction("Cards", GuardianGlyph.Card, transformationSpec) { navigate(Routes.CARDS) }
            homeAction("Portfolio", GuardianGlyph.Shield, transformationSpec) { navigate(Routes.PORTFOLIO) }
            homeAction("Spending", GuardianGlyph.Bars, transformationSpec) { navigate(Routes.SPENDING) }
            homeAction("Travel", GuardianGlyph.Plane, transformationSpec) { navigate(Routes.TRAVEL) }
            homeAction("Receive", GuardianGlyph.Qr, transformationSpec) { navigate(Routes.QUICKPAY) }
        }
    }
}

/**
 * One action row — leading mint glyph on the deep-teal surface (mockups'
 * "SYNC STATE" face), never a filled-primary slab. No emoji. Each row carries
 * the shared [TransformationSpec] so it shrinks and fades along the bezel.
 */
private fun TransformingLazyColumnScope.homeAction(
    label: String,
    glyph: GuardianGlyph,
    spec: TransformationSpec,
    onClick: () -> Unit,
) {
    item {
        Button(
            onClick = onClick,
            colors = ButtonDefaults.filledTonalButtonColors(),
            transformation = SurfaceTransformation(spec),
            modifier = Modifier
                .fillMaxWidth()
                .transformedHeight(this, spec),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                GlyphIcon(glyph)
                Spacer(modifier = Modifier.width(8.dp))
                Text(label, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}
