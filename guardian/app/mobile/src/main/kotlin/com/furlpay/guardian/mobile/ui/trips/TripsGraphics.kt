package com.furlpay.guardian.mobile.ui.trips

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.furlpay.guardian.domain.trips.boardingPassBars

// ---------------------------------------------------------------------------
// Drawing primitives for the Trips surface — the counterpart of
// ios/FurlPayGuardian/Shared/UI/TripsViews.swift.
//
// The aircraft is a path rather than an icon-font glyph. Material's core icon
// set has no aircraft, and pulling material-icons-extended (a large artifact)
// into the app for one 12dp mark is a poor trade when the shape is nine points.
//
// The route graphics are decorative and carry nothing the surrounding text does
// not already state, so they clear their semantics: a screen reader announcing
// "image" between the flight number and the gate is noise.
// ---------------------------------------------------------------------------

/**
 * Aircraft silhouette pointing right, centred on [centre] and [size] wide.
 *
 * Coordinates are a unit box scaled by half the requested size, so the same
 * path serves the 12dp mark on the live card and the 22dp one on the arc.
 */
private fun DrawScope.drawAircraft(centre: Offset, size: Dp, color: Color) {
    val half = size.toPx() / 2f
    fun p(x: Float, y: Float) = Offset(centre.x + x * half, centre.y + y * half)

    val path = Path().apply {
        val nose = p(1.0f, 0.0f)
        moveTo(nose.x, nose.y)
        listOf(
            -0.62f to 0.58f, // swept left wing tip
            -0.36f to 0.14f, // wing root
            -1.0f to 0.14f, // tailplane
            -1.0f to -0.14f,
            -0.36f to -0.14f,
            -0.62f to -0.58f, // swept right wing tip
        ).forEach { (x, y) -> p(x, y).let { lineTo(it.x, it.y) } }
        close()
    }
    drawPath(path = path, color = color)
}

/**
 * Flat dashed run with the aircraft at its head, as on the live flight card.
 *
 * Progress is DRAWN, never animated. The position only changes when a new pass
 * arrives from the server, and a continuously-running animation on a screen
 * that is already ticking a countdown buys nothing but battery.
 */
@Composable
fun RouteTrack(
    progress: Double,
    modifier: Modifier = Modifier,
) {
    val clamped = progress.coerceIn(0.0, 1.0).toFloat()

    Canvas(
        modifier
            .fillMaxWidth()
            .height(22.dp)
            .clearAndSetSemantics { },
    ) {
        val y = size.height / 2f
        val planeX = (size.width * (0.12f + 0.76f * clamped))
            .coerceIn(10f, (size.width - 10f).coerceAtLeast(10f))

        drawLine(
            color = TripsPalette.green.copy(alpha = 0.55f),
            start = Offset(2f, y),
            end = Offset(size.width - 2f, y),
            strokeWidth = 1.6.dp.toPx(),
            cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 5.dp.toPx())),
        )

        if (clamped > 0f) {
            drawLine(
                color = TripsPalette.greenBright,
                start = Offset(2f, y),
                end = Offset(planeX, y),
                strokeWidth = 1.8.dp.toPx(),
                cap = StrokeCap.Round,
            )
        }

        drawAircraft(Offset(planeX, y), 12.dp, Color.White)
    }
}

/**
 * The trajectory on the flight status card: a shallow climb that flattens out
 * under the aircraft. The flown portion is solid against a dashed remainder —
 * the convention every airline map already uses, so it needs no legend.
 */
@Composable
fun RouteArc(
    progress: Double,
    modifier: Modifier = Modifier,
) {
    val clamped = progress.coerceIn(0.0, 1.0).toFloat()

    Canvas(modifier.clearAndSetSemantics { }) {
        // Quadratic control points in the same 250x66 design space the SwiftUI
        // version uses, scaled to whatever width this card is given.
        fun point(t: Float): Offset {
            val a = (1 - t) * (1 - t)
            val b = 2 * (1 - t) * t
            val c = t * t
            return Offset(
                (a * 2f + b * 140f + c * 232f) / 250f * size.width,
                (a * 58f + b * 4f + c * 10f) / 66f * size.height,
            )
        }

        val start = point(0f)
        val end = point(1f)
        val control = Offset(140f / 250f * size.width, 4f / 66f * size.height)

        drawPath(
            path = Path().apply {
                moveTo(start.x, start.y)
                quadraticTo(control.x, control.y, end.x, end.y)
            },
            color = TripsPalette.arcDash,
            style = Stroke(
                width = 2.dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 7.dp.toPx())),
            ),
        )

        if (clamped > 0f) {
            // Sampled rather than trimmed: a polyline through the flown portion
            // lands on exactly the points the bead uses, so the marker cannot
            // drift off its own line.
            drawPath(
                path = Path().apply {
                    moveTo(start.x, start.y)
                    var t = 0f
                    while (t < clamped) {
                        point(t).let { lineTo(it.x, it.y) }
                        t += 0.01f
                    }
                    point(clamped).let { lineTo(it.x, it.y) }
                },
                color = TripsPalette.greenBright,
                style = Stroke(width = 2.4.dp.toPx(), cap = StrokeCap.Round),
            )
        }

        drawCircle(color = TripsPalette.bead, radius = 4.dp.toPx(), center = point(clamped))
        drawAircraft(end, 22.dp, TripsPalette.arcPlane)
    }
}

/**
 * Boarding-pass barcode.
 *
 * Even indices are bars, odd indices the gaps between them — the same reading
 * of [boardingPassBars] that web, Expo and SwiftUI use.
 *
 * The strip is NOT scannable (see the note on [boardingPassBars]); the gate
 * screen prints the flight number and booking reference beside it so nobody is
 * left waving an unreadable phone at a reader.
 */
@Composable
fun BarcodeStrip(
    value: String,
    height: Dp,
    modifier: Modifier = Modifier,
) {
    val bars = remember(value) { boardingPassBars(value) }
    val total = remember(bars) { bars.sum() }

    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .semantics { contentDescription = "Boarding pass barcode for $value" },
    ) {
        val unit = size.width / total
        var x = 0f
        bars.forEachIndexed { index, width ->
            val w = width * unit
            if (index % 2 == 0) {
                drawRect(
                    color = TripsPalette.barcodeInk,
                    topLeft = Offset(x, 0f),
                    size = Size(w, size.height),
                )
            }
            x += w
        }
    }
}
