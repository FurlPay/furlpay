package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.domain.model.Candle
import com.furlpay.guardian.wear.viewmodel.StockViewModel
import com.furlpay.guardian.wear.ui.theme.FurlPayColors

/**
 * The mockups' stock screen: name (symbol), live price + change, a real
 * area chart, timeframe chips, Buy / Sell. The order flow is two explicit
 * steps (amount, then confirm) — the watch analogue of the phone's
 * biometric confirm, same policy as card freeze.
 */
@Composable
fun StockScreen(symbol: String, viewModel: StockViewModel = viewModel()) {
    LaunchedEffect(symbol) { viewModel.start(symbol) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val haptics = rememberHaptics()

    ScreenScaffold {
        when (val order = state.order) {
            is StockViewModel.OrderFlow.Idle -> ChartFace(state, viewModel, haptics)

            is StockViewModel.OrderFlow.PickAmount -> Column(
                modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = (if (order.side == "buy") "Buy" else "Sell") + " ${state.symbol}",
                    style = MaterialTheme.typography.titleMedium,
                )
                StockViewModel.AMOUNTS.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        pair.forEach { amount ->
                            Button(
                                onClick = { haptics.click(); viewModel.pickAmount(amount) },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(compactUsd(amount), modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            }
                        }
                    }
                }
                OutlinedButton(onClick = { viewModel.dismissOrder() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
            }

            is StockViewModel.OrderFlow.Confirm -> Column(
                modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = (if (order.side == "buy") "Buy" else "Sell") +
                        " ${usd(order.notionalUsd)} of ${state.symbol}?",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = "Fractional market order",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { haptics.heavyClick(); viewModel.confirmOrder() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = if (order.side == "sell") {
                        ButtonDefaults.buttonColors(
                            containerColor = FurlPayColors.Error,
                            contentColor = FurlPayColors.OnError,
                        )
                    } else {
                        ButtonDefaults.buttonColors()
                    },
                ) {
                    Text("Confirm", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
                OutlinedButton(onClick = { viewModel.dismissOrder() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
            }

            is StockViewModel.OrderFlow.Placing -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            is StockViewModel.OrderFlow.Placed -> ResultFace(
                title = order.message,
                color = FurlPayColors.MoneyPositive,
                onDone = { viewModel.dismissOrder() },
            )

            is StockViewModel.OrderFlow.Failed -> ResultFace(
                title = order.message,
                color = MaterialTheme.colorScheme.error,
                onDone = { viewModel.dismissOrder() },
            )
        }
    }
}

@Composable
private fun ChartFace(
    state: StockViewModel.UiState,
    viewModel: StockViewModel,
    haptics: Haptics,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(top = 26.dp, bottom = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val quote = state.detail?.quote
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = quote?.name?.ifBlank { state.symbol } ?: state.symbol,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "(${state.symbol})",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        quote?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = usd(it.price) + " USD", style = MaterialTheme.typography.labelMedium)
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = signedPct(it.changePct),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (it.changePct >= 0) FurlPayColors.MoneyPositive else FurlPayColors.Error,
                )
            }
        }

        Box(modifier = Modifier.weight(1f).fillMaxWidth().padding(vertical = 4.dp)) {
            when {
                state.candles.size >= 2 -> AreaChart(state.candles)
                state.chartLoading || state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }
                else -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = state.error ?: "No price history",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        if (state.detail?.tradable != false) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(horizontal = 26.dp),
            ) {
                Button(
                    onClick = { haptics.click(); viewModel.beginOrder("buy") },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("+ Buy", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
                OutlinedButton(
                    onClick = { haptics.click(); viewModel.beginOrder("sell") },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("− Sell", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier
                .padding(top = 6.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 26.dp),
        ) {
            StockViewModel.TIMEFRAMES.forEach { tf ->
                val selected = tf == state.timeframe
                Text(
                    text = tf,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) FurlPayColors.Primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clickableNoRipple {
                            haptics.tick()
                            viewModel.setTimeframe(tf)
                        },
                )
            }
        }
    }
}

@Composable
private fun ResultFace(title: String, color: Color, onDone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = color,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
            Text("Done", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        }
    }
}

/** Ripple-free tap — timeframe chips are too small for a ripple bound. */
@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        onClick = onClick,
    )

/** Mint area chart — gradient fill fading to black, 2dp line, no axes. */
@Composable
fun AreaChart(candles: List<Candle>, modifier: Modifier = Modifier) {
    val closes = candles.map { it.close }
    val up = closes.last() >= closes.first()
    val line = if (up) FurlPayColors.Primary else FurlPayColors.Error
    Canvas(modifier = modifier.fillMaxSize()) {
        val min = closes.min()
        val max = closes.max()
        val span = (max - min).takeIf { it > 0 } ?: 1.0
        val stroke = Path()
        closes.forEachIndexed { i, v ->
            val x = size.width * i / (closes.size - 1).coerceAtLeast(1)
            val y = (size.height - 6.dp.toPx()) * (1f - ((v - min) / span).toFloat()) + 3.dp.toPx()
            if (i == 0) stroke.moveTo(x, y) else stroke.lineTo(x, y)
        }
        val area = Path().apply {
            addPath(stroke)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            close()
        }
        drawPath(
            area,
            Brush.verticalGradient(
                colors = listOf(line.copy(alpha = 0.30f), Color.Transparent),
                endY = size.height,
            ),
        )
        drawPath(
            stroke,
            line,
            style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}
