package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.furlpay.guardian.domain.model.MarketQuote
import com.furlpay.guardian.wear.viewmodel.MarketsViewModel
import com.furlpay.guardian.wear.ui.theme.FurlPayColors

/**
 * Live watchlist — the mockups' "Guardian Safe" list: real asset logo, name
 * (symbol), price, signed change, and a real 1D sparkline per row. Tap a row
 * for the full chart + Buy/Sell.
 */
@Composable
fun MarketsScreen(navController: NavController, viewModel: MarketsViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    val haptics = rememberHaptics()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(state = columnState, contentPadding = contentPadding) {
            item {
                Text(
                    text = "Markets",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (state.loading) {
                item { CircularProgressIndicator() }
            }
            state.error?.let { error ->
                item {
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            items(state.quotes.size) { index ->
                val quote = state.quotes[index]
                QuoteRow(
                    quote = quote,
                    spark = state.sparks[quote.symbol],
                    transformation = SurfaceTransformation(transformationSpec),
                    modifier = Modifier.transformedHeight(this, transformationSpec),
                    onClick = {
                        haptics.click()
                        navController.navigate("stock/${quote.symbol}")
                    },
                )
            }
        }
    }
}

@Composable
private fun QuoteRow(
    quote: MarketQuote,
    spark: List<Double>?,
    transformation: SurfaceTransformation,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val up = quote.changePct >= 0
    val trend = if (up) FurlPayColors.MoneyPositive else FurlPayColors.Error
    Card(onClick = onClick, transformation = transformation, modifier = modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AssetLogo(symbol = quote.symbol, logoPath = quote.logoPath)
            Spacer(modifier = Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = quote.name.ifBlank { quote.symbol },
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "(${quote.symbol})",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = usd(quote.price),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                        text = signedPct(quote.changePct),
                        style = MaterialTheme.typography.labelSmall,
                        color = trend,
                    )
                }
            }
            spark?.takeIf { it.size >= 2 }?.let { closes ->
                Spacer(modifier = Modifier.width(6.dp))
                Sparkline(closes = closes, color = trend)
            }
        }
    }
}

/** Tiny real-data 1D line — 28x16dp, stroke only, no axes. */
@Composable
fun Sparkline(closes: List<Double>, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.size(width = 28.dp, height = 16.dp)) {
        val min = closes.min()
        val max = closes.max()
        val span = (max - min).takeIf { it > 0 } ?: 1.0
        val path = Path()
        closes.forEachIndexed { i, v ->
            val x = size.width * i / (closes.size - 1).coerceAtLeast(1)
            val y = size.height - ((v - min) / span * size.height).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(
            path,
            color,
            style = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}
