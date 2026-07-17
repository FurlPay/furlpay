package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.furlpay.guardian.wear.viewmodel.PortfolioViewModel

/**
 * "How are my investments?" — total, day change (green = gains, red = losses,
 * per the bible's money-semantic palette), then the biggest holdings. A
 * holding taps through to its full chart + Buy/Sell (same StockScreen the
 * Markets list uses).
 */
@Composable
fun PortfolioScreen(
    navController: NavController,
    viewModel: PortfolioViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    val haptics = rememberHaptics()

    val changeColor =
        if (state.dayChangeUsd >= 0) MaterialTheme.colorScheme.secondary
        else MaterialTheme.colorScheme.error

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                when {
                    state.loading -> SkeletonAmount()
                    state.totalUsd != null -> Text(
                        text = usd(animatedUsd(state.totalUsd!!)),
                        style = MaterialTheme.typography.displaySmall,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    else -> Text(
                        text = "No data",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            if (!state.loading && state.totalUsd != null) {
                item {
                    Text(
                        text = signedUsd(state.dayChangeUsd) + " today (" + signedPct(state.dayChangePct) + ")",
                        style = MaterialTheme.typography.labelMedium,
                        color = changeColor,
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
            items(state.positions.size) { index ->
                val position = state.positions[index]
                val positionColor =
                    if (position.dayChangePct >= 0) MaterialTheme.colorScheme.secondary
                    else MaterialTheme.colorScheme.error
                Card(
                    onClick = {
                        haptics.click()
                        navController.navigate("stock/${position.symbol}")
                    },
                    transformation = SurfaceTransformation(transformationSpec),
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedHeight(this, transformationSpec),
                ) {
                    Text(
                        text = position.symbol,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = usd(position.usdValue) + "  " + signedPct(position.dayChangePct),
                        style = MaterialTheme.typography.labelSmall,
                        color = positionColor,
                    )
                }
            }
        }
    }
}
