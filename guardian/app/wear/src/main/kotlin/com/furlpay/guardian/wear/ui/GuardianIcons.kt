package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.furlpay.guardian.wear.ui.theme.FurlPayColors

/**
 * Guardian's vector icon set — no emoji anywhere (brand voice), no icon-font
 * dependency. Every glyph is drawn on a 24-unit grid with a consistent 2-unit
 * stroke so the set reads as one family. [FurlPayMark] is the exact
 * apps/web/public/furlpay-mark.svg geometry (gradient tile + white F).
 */
enum class GuardianGlyph { Wallet, Card, Chart, Bars, Qr, Mic, Plane, Shield }

@Composable
fun GlyphIcon(
    glyph: GuardianGlyph,
    modifier: Modifier = Modifier,
    size: Dp = 18.dp,
    tint: Color = FurlPayColors.Primary,
) {
    Canvas(modifier = modifier.size(size)) {
        val u = this.size.minDimension / 24f
        val stroke = Stroke(width = 2f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        when (glyph) {
            GuardianGlyph.Wallet -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(3f * u, 6f * u),
                    size = Size(18f * u, 13f * u),
                    cornerRadius = CornerRadius(3f * u),
                    style = stroke,
                )
                drawLine(tint, Offset(15f * u, 12.5f * u), Offset(17.5f * u, 12.5f * u), 2f * u, StrokeCap.Round)
            }
            GuardianGlyph.Card -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(3f * u, 6f * u),
                    size = Size(18f * u, 13f * u),
                    cornerRadius = CornerRadius(2.5f * u),
                    style = stroke,
                )
                drawLine(tint, Offset(3f * u, 10f * u), Offset(21f * u, 10f * u), 2f * u)
            }
            GuardianGlyph.Chart -> polyline(tint, u, 3f to 17f, 9f to 10f, 13f to 13.5f, 21f to 6f)
            GuardianGlyph.Bars -> {
                drawLine(tint, Offset(6f * u, 19f * u), Offset(6f * u, 13f * u), 3f * u, StrokeCap.Round)
                drawLine(tint, Offset(12f * u, 19f * u), Offset(12f * u, 6f * u), 3f * u, StrokeCap.Round)
                drawLine(tint, Offset(18f * u, 19f * u), Offset(18f * u, 10f * u), 3f * u, StrokeCap.Round)
            }
            GuardianGlyph.Qr -> {
                val s = Stroke(width = 2f * u, join = StrokeJoin.Round)
                drawRoundRect(tint, Offset(4f * u, 4f * u), Size(6f * u, 6f * u), CornerRadius(1.5f * u), style = s)
                drawRoundRect(tint, Offset(14f * u, 4f * u), Size(6f * u, 6f * u), CornerRadius(1.5f * u), style = s)
                drawRoundRect(tint, Offset(4f * u, 14f * u), Size(6f * u, 6f * u), CornerRadius(1.5f * u), style = s)
                drawRoundRect(tint, Offset(14f * u, 14f * u), Size(2.6f * u, 2.6f * u), CornerRadius(0.8f * u))
                drawRoundRect(tint, Offset(17.4f * u, 17.4f * u), Size(2.6f * u, 2.6f * u), CornerRadius(0.8f * u))
            }
            GuardianGlyph.Mic -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(9.5f * u, 3f * u),
                    size = Size(5f * u, 10f * u),
                    cornerRadius = CornerRadius(2.5f * u),
                    style = stroke,
                )
                val arc = Path().apply {
                    moveTo(6f * u, 11.5f * u)
                    cubicTo(6f * u, 16f * u, 18f * u, 16f * u, 18f * u, 11.5f * u)
                }
                drawPath(arc, tint, style = stroke)
                drawLine(tint, Offset(12f * u, 15.8f * u), Offset(12f * u, 20f * u), 2f * u, StrokeCap.Round)
            }
            GuardianGlyph.Plane -> {
                val p = Path().apply {
                    moveTo(21f * u, 15f * u)
                    lineTo(13.5f * u, 12.2f * u)
                    lineTo(13.5f * u, 6.2f * u)
                    cubicTo(13.5f * u, 4.4f * u, 10.5f * u, 4.4f * u, 10.5f * u, 6.2f * u)
                    lineTo(10.5f * u, 12.2f * u)
                    lineTo(3f * u, 15f * u)
                    lineTo(3f * u, 17f * u)
                    lineTo(10.5f * u, 15.4f * u)
                    lineTo(10.5f * u, 18.4f * u)
                    lineTo(8.6f * u, 19.8f * u)
                    lineTo(8.6f * u, 21f * u)
                    lineTo(12f * u, 20.2f * u)
                    lineTo(15.4f * u, 21f * u)
                    lineTo(15.4f * u, 19.8f * u)
                    lineTo(13.5f * u, 18.4f * u)
                    lineTo(13.5f * u, 15.4f * u)
                    lineTo(21f * u, 17f * u)
                    close()
                }
                drawPath(p, tint)
            }
            GuardianGlyph.Shield -> {
                val p = Path().apply {
                    moveTo(12f * u, 3f * u)
                    lineTo(19f * u, 6f * u)
                    lineTo(19f * u, 12f * u)
                    cubicTo(19f * u, 16.5f * u, 16f * u, 19.5f * u, 12f * u, 21f * u)
                    cubicTo(8f * u, 19.5f * u, 5f * u, 16.5f * u, 5f * u, 12f * u)
                    lineTo(5f * u, 6f * u)
                    close()
                }
                drawPath(p, tint, style = stroke)
            }
        }
    }
}

private fun DrawScope.polyline(tint: Color, u: Float, vararg pts: Pair<Float, Float>) {
    val path = Path()
    pts.forEachIndexed { i, (x, y) ->
        if (i == 0) path.moveTo(x * u, y * u) else path.lineTo(x * u, y * u)
    }
    drawPath(path, tint, style = Stroke(width = 2f * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/**
 * The FurlPay mark — apps/web/public/furlpay-mark.svg exactly: #1C0F35 to
 * #E02020 gradient tile (rx 88/400) with the white F path, scaled to [size].
 */
@Composable
fun FurlPayMark(modifier: Modifier = Modifier, size: Dp = 22.dp) {
    Canvas(modifier = modifier.size(size)) {
        val u = this.size.minDimension / 400f
        drawRoundRect(
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF1C0F35), Color(0xFFE02020)),
                start = Offset.Zero,
                end = Offset(400f * u, 400f * u),
            ),
            cornerRadius = CornerRadius(88f * u),
        )
        val f = Path().apply {
            moveTo(150f * u, 108f * u)
            lineTo(258f * u, 108f * u)
            arcTo(rect(258f, 108f, 12f, u), -90f, 180f, false)
            lineTo(162f * u, 132f * u)
            lineTo(162f * u, 188f * u)
            lineTo(246f * u, 188f * u)
            arcTo(rect(246f, 188f, 12f, u), -90f, 180f, false)
            lineTo(162f * u, 212f * u)
            lineTo(162f * u, 288f * u)
            arcTo(rect(150f, 288f, 12f, u), 0f, 180f, false)
            lineTo(138f * u, 120f * u)
            arcTo(rect(150f, 108f, 12f, u), 180f, 90f, false)
            close()
        }
        drawPath(f, Color.White)
    }
}

private fun rect(cx: Float, cy: Float, r: Float, u: Float) =
    androidx.compose.ui.geometry.Rect(
        center = Offset(cx * u, cy * u),
        radius = r * u,
    )

/** Two-letter monogram tile — the native <AssetLogo> stub, watch-sized. */
@Composable
fun MonogramTile(
    symbol: String,
    modifier: Modifier = Modifier,
    size: Dp = 30.dp,
    content: (@Composable () -> Unit)? = null,
) {
    Box(
        modifier = modifier
            .size(size)
            .background(Color(0xFF12352C), RoundedCornerShape(size / 4)),
        contentAlignment = Alignment.Center,
    ) {
        androidx.wear.compose.material3.Text(
            text = symbol.take(2).uppercase(),
            color = FurlPayColors.Primary,
            style = androidx.wear.compose.material3.MaterialTheme.typography.labelSmall,
        )
        content?.invoke()
    }
}
