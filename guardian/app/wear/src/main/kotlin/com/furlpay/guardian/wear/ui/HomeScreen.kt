package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.viewmodel.HomeViewModel
import java.time.LocalTime

/**
 * The AI Brief — everything worth knowing in 3 seconds, THEN navigation.
 * Greeting, net worth + day change, one honest insight line (tap = ask
 * Guardian about it), what's next, and two rows of glyph quick-actions
 * instead of seven full-width buttons. Ask Guardian stays on the edge.
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
            modifier = Modifier.rotaryScroll(columnState),
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
                        text = greeting(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // ---- The brief ----
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
            state.dayChangeUsd?.let { change ->
                if (!state.signedOut) {
                    item {
                        Text(
                            text = signedUsd(change) +
                                (state.dayChangePct?.let { " (" + signedPct(it) + ")" } ?: "") +
                                " today",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (change >= 0) MaterialTheme.colorScheme.secondary
                            else MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
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

            // Insight line — tap hands the topic to Guardian.
            state.insight?.let { insight ->
                item {
                    Card(
                        onClick = { navigate(Routes.VOICE) },
                        transformation = SurfaceTransformation(transformationSpec),
                        modifier = Modifier
                            .fillMaxWidth()
                            .transformedHeight(this, transformationSpec),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            GlyphIcon(GuardianGlyph.Spark, size = 14.dp)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = insight,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }

            // ---- What's next ----
            state.nextEventTitle?.let { title ->
                item { BriefRow(GuardianGlyph.Calendar, title, "next event") }
            }
            state.nextTripTitle?.let { title ->
                item {
                    BriefRow(
                        GuardianGlyph.Plane,
                        title,
                        state.tripDaysLeft?.let { days ->
                            if (days == 0) "departs today" else "in $days days"
                        } ?: "upcoming trip",
                    )
                }
            }

            // ---- Quick actions: glyphs, not a wall of buttons ----
            item {
                QuickActionRow(
                    listOf(
                        Triple("Markets", GuardianGlyph.Chart, Routes.MARKETS),
                        Triple("Wallet", GuardianGlyph.Wallet, Routes.WALLET),
                        Triple("Cards", GuardianGlyph.Card, Routes.CARDS),
                        Triple("Portfolio", GuardianGlyph.Gauge, Routes.PORTFOLIO),
                    ),
                    ::navigate,
                )
            }
            item {
                QuickActionRow(
                    listOf(
                        Triple("Spending", GuardianGlyph.Bars, Routes.SPENDING),
                        Triple("Travel", GuardianGlyph.Plane, Routes.TRAVEL),
                        Triple("Receive", GuardianGlyph.Qr, Routes.QUICKPAY),
                        Triple("Buy USDC", GuardianGlyph.Spark, Routes.BUY),
                    ),
                    ::navigate,
                )
            }
        }
    }
}

/** "Good morning" by watch-local hour — no name, no exclamation marks. */
private fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    else -> "Good evening"
}

/** One glanceable context row: glyph, title, quiet caption. Display-only. */
@Composable
private fun BriefRow(glyph: GuardianGlyph, title: String, caption: String) {
    InfoCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlyphIcon(glyph, size = 16.dp)
            Spacer(modifier = Modifier.width(8.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = caption,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Round tonal glyph buttons — TalkBack reads the label, eyes read the glyph. */
@Composable
private fun QuickActionRow(
    actions: List<Triple<String, GuardianGlyph, String>>,
    navigate: (String) -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
    ) {
        actions.forEach { (label, glyph, route) ->
            FilledTonalIconButton(
                onClick = { navigate(route) },
                modifier = Modifier.semantics { contentDescription = label },
            ) {
                GlyphIcon(glyph, size = 20.dp)
            }
        }
    }
}
