package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.wear.viewmodel.SpendingViewModel

/**
 * "Am I on budget?" — spend total for today / this week / this month.
 * Period switch ticks (haptic) so the change registers without looking twice.
 */
@Composable
fun SpendingScreen(viewModel: SpendingViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val haptics = rememberHaptics()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                Text(
                    text = when {
                        state.loading -> "…"
                        state.summary != null -> usd(state.summary!!.totalUsd)
                        else -> "No data"
                    },
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                val label = when (state.period) {
                    SpendingPeriod.TODAY -> "spent today"
                    SpendingPeriod.THIS_WEEK -> "spent this week"
                    SpendingPeriod.THIS_MONTH -> "spent this month"
                }
                val count = state.summary?.transactionCount ?: 0
                Text(
                    text = if (count > 0) "$label · $count tx" else label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            state.summary?.topCategory?.let { category ->
                item {
                    Text(
                        text = "most on $category",
                        style = MaterialTheme.typography.labelSmall,
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
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
                ) {
                    PeriodChip("Day", state.period == SpendingPeriod.TODAY) {
                        haptics.tick()
                        viewModel.onPeriodSelected(SpendingPeriod.TODAY)
                    }
                    PeriodChip("Week", state.period == SpendingPeriod.THIS_WEEK) {
                        haptics.tick()
                        viewModel.onPeriodSelected(SpendingPeriod.THIS_WEEK)
                    }
                    PeriodChip("Month", state.period == SpendingPeriod.THIS_MONTH) {
                        haptics.tick()
                        viewModel.onPeriodSelected(SpendingPeriod.THIS_MONTH)
                    }
                }
            }
        }
    }
}

@Composable
private fun PeriodChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = if (selected) ButtonDefaults.buttonColors() else ButtonDefaults.outlinedButtonColors(),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}
